import type { PublicMotion } from './main';
const model = document.querySelector<HTMLSelectElement>('#demo-model')!;
const requested = new URLSearchParams(location.search).get('demo');
// Only explicit conformance entry points expose the internal fixture navigation.
if (requested === 'rig') model.add(new Option('Synthetic rigs', 'rig'));
const picker = document.querySelector<HTMLElement>('#preset-picker')!;
const sections = {
  uka: document.querySelector<HTMLElement>('#gene-demo')!,
  gene: document.querySelector<HTMLElement>('#gene-demo')!,
  rig: document.querySelector<HTMLElement>('#rig-demo')!,
};
type Demo = keyof typeof sections;
type Viewer = { setActive(active: boolean): void; dispose?(): Promise<void> };
const viewers: Partial<Record<Demo, Viewer>> = {};
let current: Demo | undefined;

async function show(demo: Demo, motion: PublicMotion = 'rest') {
  model.disabled = true;
  if (current) viewers[current]?.setActive(false);
  current = demo;
  model.value = demo;
  picker.hidden = demo !== 'rig';
  sections.gene.hidden = demo === 'rig';
  sections.rig.hidden = demo !== 'rig';
  const status = document.querySelector<HTMLElement>(`#${demo === 'rig' ? 'rig' : 'gene'}-status`)!;
  try {
    if (!viewers[demo]) {
      status.dataset.error = 'false';
      if (demo !== 'rig') {
        status.textContent = 'Loading PMX and converted glTF…';
        const previous = demo === 'uka' ? 'gene' : 'uka';
        await viewers[previous]?.dispose?.();
        delete viewers[previous];
        for (const id of ['material','outlines','expression']) {
          const control = document.querySelector<HTMLSelectElement>(`#${id}`)!;
          control.selectedIndex = 0; control.disabled = true;
        }
        document.querySelector<HTMLElement>('#uka-features')!.hidden = demo !== 'uka';
        sections.gene.setAttribute('aria-label', `${demo === 'uka' ? 'Uka' : 'Gene Light'} comparison`);
        for (const pane of Array.from(document.querySelectorAll<HTMLElement>('.pane p'))) {
          delete pane.dataset.error;
          delete pane.dataset.ready;
          pane.textContent = 'Loading…';
        }
        viewers[demo] = await (await import('./main')).startComparison(demo, motion);
      } else {
        // On narrow screens the viewport comes first, with compact disclosures below it.
        if (matchMedia('(max-width:900px)').matches) {
          sections.rig.querySelectorAll<HTMLDetailsElement>('details').forEach(details => { details.open = false; });
          sections.rig.querySelector<HTMLDetailsElement>('#motion-controls')!.open = true;
        }
        viewers.rig = await (await import('./rig')).startRig();
      }
    }
    viewers[demo]!.setActive(true);
    document.querySelector('#demo-retry')?.remove();
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = `${demo !== 'rig' ? 'Could not load/render the comparison' : 'Could not load the rig'}: ${String(error)}`;
    const retry = document.createElement('button');
    retry.id = 'demo-retry';
    retry.textContent = 'Retry loading';
    retry.onclick = () => { retry.remove(); void show(demo,motion); };
    status.append(' ', retry);
  } finally {
    model.disabled = false;
  }
}
model.addEventListener('change', () => { void show(model.value as Demo); });
void show(requested === 'rig' || requested === 'gene' ? requested : 'uka');
