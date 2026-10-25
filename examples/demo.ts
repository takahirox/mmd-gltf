const model = document.querySelector<HTMLSelectElement>('#demo-model')!;
const picker = document.querySelector<HTMLElement>('#preset-picker')!;
const sections = {
  gene: document.querySelector<HTMLElement>('#gene-demo')!,
  rig: document.querySelector<HTMLElement>('#rig-demo')!,
};
type Demo = keyof typeof sections;
type Viewer = { setActive(active: boolean): void };
const viewers: Partial<Record<Demo, Viewer>> = {};
let current: Demo | undefined;

async function show(demo: Demo) {
  model.disabled = true;
  if (current) viewers[current]?.setActive(false);
  current = demo;
  model.value = demo;
  picker.hidden = demo !== 'rig';
  for (const [key, section] of Object.entries(sections)) section.hidden = key !== demo;
  const status = document.querySelector<HTMLElement>(`#${demo}-status`)!;
  try {
    if (!viewers[demo]) {
      status.dataset.error = 'false';
      if (demo === 'gene') {
        for (const pane of Array.from(document.querySelectorAll<HTMLElement>('.pane p'))) {
          delete pane.dataset.error;
          delete pane.dataset.ready;
          pane.textContent = 'Loading…';
        }
        viewers.gene = await (await import('./main')).startComparison();
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
    status.textContent = `${demo === 'gene' ? 'Could not load/render the comparison' : 'Could not load the rig'}: ${String(error)}`;
    const retry = document.createElement('button');
    retry.id = 'demo-retry';
    retry.textContent = 'Retry loading';
    retry.onclick = () => { retry.remove(); void show(demo); };
    status.append(' ', retry);
  } finally {
    model.disabled = false;
  }
}
model.addEventListener('change', () => { void show(model.value as Demo); });
void show(new URLSearchParams(location.search).get('demo') === 'rig' ? 'rig' : 'gene');
