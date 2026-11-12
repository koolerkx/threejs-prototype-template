import { BUDGET_NAMES, BUDGETS, overBudget, type Budget, type BudgetName, type PerfMonitor, type PerfSnapshot } from '../core/perf';

// Realtime profiler over the viewport (top left): fps, frame / CPU / GPU time, draw calls, triangles, memory,
// a frame-time graph with the budget line, and a budget target selector. Key P toggles it.

const BUDGET_KEY = 'proto.perf.budget';
const TEXT_EVERY = 15; // frames between text updates
const GRAPH_W = 220;
const GRAPH_H = 52;
const GRAPH_MAX_MS = 50;

function loadBudgetName(): BudgetName {
  try {
    const v = localStorage.getItem(BUDGET_KEY);
    if (v && v in BUDGETS) return v as BudgetName;
  } catch {
    // storage unavailable
  }
  return 'PC 60';
}

export class PerfHud {
  private readonly root = document.createElement('div');
  private readonly rows = document.createElement('div');
  private readonly graph = document.createElement('canvas');
  private readonly select = document.createElement('select');
  private budgetName = loadBudgetName();
  private override: Partial<Budget> = {};
  private frame = 0;
  private enabled = true;

  constructor(private readonly monitor: PerfMonitor) {
    this.root.id = 'perf';
    this.rows.className = 'rows';
    this.graph.width = GRAPH_W * devicePixelRatio;
    this.graph.height = GRAPH_H * devicePixelRatio;
    this.graph.style.width = `${GRAPH_W}px`;
    this.graph.style.height = `${GRAPH_H}px`;
    for (const name of BUDGET_NAMES) this.select.add(new Option(`Budget: ${name}`, name));
    this.select.value = this.budgetName;
    this.select.addEventListener('change', () => {
      this.budgetName = this.select.value as BudgetName;
      try {
        localStorage.setItem(BUDGET_KEY, this.budgetName);
      } catch {
        // storage unavailable
      }
    });
    this.root.append(this.rows, this.graph, this.select);
    document.body.append(this.root);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !(e.target instanceof HTMLInputElement) && !e.ctrlKey && !e.metaKey) this.toggle();
    });
  }

  /** Budget in effect: the selected target with the experiment's overrides. */
  get budget(): Budget {
    return { ...BUDGETS[this.budgetName], ...this.override };
  }

  setOverride(override: Partial<Budget> | undefined): void {
    this.override = override ?? {};
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible || !this.enabled;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.root.hidden = !this.enabled;
  }

  update(): void {
    if (this.root.hidden) return;
    this.frame++;
    if (this.frame % 2 === 0) this.drawGraph();
    if (this.frame % TEXT_EVERY === 0) this.drawText(this.monitor.snapshot());
  }

  private drawText(s: PerfSnapshot): void {
    const b = this.budget;
    const over = new Set(overBudget(s, b));
    const row = (label: string, value: string, key?: string, limit?: string) =>
      `<div class="${key && over.has(key) ? 'over' : ''}"><span>${label}</span><b>${value}</b>${limit ? `<i>/ ${limit}</i>` : ''}</div>`;
    this.rows.innerHTML = [
      row('backend', s.backend),
      row('fps', s.fps.toFixed(0)),
      row('frame', `${s.frameMs.toFixed(2)} ms`, 'frame', `${b.frameMs} ms`),
      row('cpu', `${s.cpuMs.toFixed(2)} ms`),
      row('gpu', s.gpuMs === null ? 'n/a' : `${s.gpuMs.toFixed(2)} ms`, 'gpu', `${b.frameMs} ms`),
      row('draws', s.drawCalls.toLocaleString(), 'draws', b.drawCalls.toLocaleString()),
      row('tris', s.triangles.toLocaleString(), 'tris', b.triangles.toLocaleString()),
      row('memory', `${s.memoryMB.toFixed(1)} MB`, 'memory', `${b.memoryMB} MB`),
      row('geo / tex / prog', `${s.geometries} / ${s.textures} / ${s.programs}`),
    ].join('');
    this.root.classList.toggle('warn', over.size > 0);
  }

  private drawGraph(): void {
    const ctx = this.graph.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.graph;
    const y = (ms: number) => h - (Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, w, h);
    const hist = this.monitor.history;
    const step = w / Math.max(hist.length - 1, 1);
    const limit = this.budget.frameMs;
    ctx.lineWidth = devicePixelRatio;
    ctx.beginPath();
    hist.forEach((ms, i) => (i === 0 ? ctx.moveTo(0, y(ms)) : ctx.lineTo(i * step, y(ms))));
    ctx.strokeStyle = '#6fd08a';
    ctx.stroke();
    ctx.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio]);
    ctx.beginPath();
    ctx.moveTo(0, y(limit));
    ctx.lineTo(w, y(limit));
    ctx.strokeStyle = '#ffb347';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
