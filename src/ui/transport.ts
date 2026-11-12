import { SPEEDS, type ExperimentClock } from '../core/clock';

// Time transport over the viewport: restart, step back, play/pause, step forward, time field, speed buttons.
// Keys: Space play/pause, ',' / '.' step one frame, '[' / ']' slower / faster, Home restart.

const SPEED_BUTTONS = SPEEDS.filter((s) => s > 0);

function formatSpeed(s: number): string {
  return `${s < 1 ? s.toString().replace(/^0/, '') : s}×`;
}

export class Transport {
  private readonly root = document.createElement('div');
  private readonly playButton: HTMLButtonElement;
  private readonly timeInput: HTMLInputElement;
  private readonly speedButtons: HTMLButtonElement[];

  constructor(private readonly clock: ExperimentClock) {
    this.root.id = 'transport';
    const button = (label: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        b.blur(); // keep Space for play/pause
        onClick();
      });
      return b;
    };

    const restart = button('⏮', 'Restart at 0 s (Home)', () => clock.set({ time: 0 }));
    const back = button('◁|', 'Step back one frame (,)', () => clock.step(-1));
    this.playButton = button('▮▮', 'Play / pause (Space)', () => clock.togglePause());
    this.playButton.className = 'play';
    const forward = button('|▷', 'Step forward one frame (.)', () => clock.step(1));

    this.timeInput = document.createElement('input');
    this.timeInput.type = 'number';
    this.timeInput.step = '0.01';
    this.timeInput.min = '0';
    this.timeInput.title = 'Time in seconds; type a value to seek (pauses)';
    this.timeInput.addEventListener('change', () => clock.set({ time: Number(this.timeInput.value), paused: true }));
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = 's';

    const speeds = document.createElement('div');
    speeds.className = 'speeds';
    this.speedButtons = SPEED_BUTTONS.map((s) => button(formatSpeed(s), `Speed ${s}× ([ / ])`, () => clock.set({ speed: s })));
    speeds.append(...this.speedButtons);

    this.root.append(restart, back, this.playButton, forward, this.timeInput, unit, speeds);
    document.body.append(this.root);

    clock.onChange(() => this.sync());
    addEventListener('keydown', (e) => this.onKey(e));
    this.sync();
  }

  /** Adds a section (e.g. camera bookmarks) to the bar. */
  append(element: HTMLElement): void {
    this.root.append(element);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Called every frame; only touches the DOM when the shown value changes. */
  update(): void {
    if (document.activeElement === this.timeInput) return;
    const text = this.clock.state.time.toFixed(2);
    if (this.timeInput.value !== text) this.timeInput.value = text;
  }

  private sync(): void {
    const { paused, speed } = this.clock.state;
    this.playButton.textContent = paused ? '▶' : '▮▮'; // ▮▮ renders in fonts that lack ⏸
    this.root.classList.toggle('paused', paused);
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', Math.abs(SPEED_BUTTONS[i] - speed) < 1e-6));
    this.update();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t.closest('.lil-gui')) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.clock.togglePause();
        break;
      case ',':
        this.clock.step(-1);
        break;
      case '.':
        this.clock.step(1);
        break;
      case '[':
        this.clock.shiftSpeed(-1);
        break;
      case ']':
        this.clock.shiftSpeed(1);
        break;
      case 'Home':
        this.clock.set({ time: 0 });
        break;
    }
  }
}
