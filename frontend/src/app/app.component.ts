import { Component, OnInit, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { environment } from '../environments/environments';

interface Incident {
  id: number;
  timestamp: string;
  raw_log: string;
  source: string;
  severity: string | null;
  explanation: string | null;
}

interface ChatSource {
  id: number;
  severity: string | null;
  raw_log: string;
  explanation: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  loading?: boolean;
}

interface Stats {
  total: number;
  unprocessed: number;
  low: number;
  med: number;
  high: number;
  critical: number;
  sources: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="app">
      <!-- Top bar -->
      <nav class="topbar">
        <div class="brand">
          <div class="brand-mark">S</div>
          <div>
            <div class="brand-name">threatERloggER</div>
            <div class="brand-sub">Log Anomaly Detection</div>
          </div>
        </div>
        <div class="topbar-right">
          <div class="status-dot"></div>
          <span class="status-text">Live</span>
        </div>
      </nav>

      <!-- Metrics strip -->
      <section class="metrics">
        <div class="metric">
          <div class="metric-label">Total incidents</div>
          <div class="metric-value">{{ stats?.total || 0 | number }}</div>
          <div class="metric-sub">{{ stats?.sources || 0 }} sources</div>
        </div>
        <div class="metric metric-critical">
          <div class="metric-label">Critical</div>
          <div class="metric-value">{{ stats?.critical || 0 }}</div>
          <div class="metric-bar"><div class="metric-bar-fill" [style.width.%]="pct('critical')"></div></div>
        </div>
        <div class="metric metric-high">
          <div class="metric-label">High</div>
          <div class="metric-value">{{ stats?.high || 0 }}</div>
          <div class="metric-bar"><div class="metric-bar-fill" [style.width.%]="pct('high')"></div></div>
        </div>
        <div class="metric metric-med">
          <div class="metric-label">Medium</div>
          <div class="metric-value">{{ stats?.med || 0 }}</div>
          <div class="metric-bar"><div class="metric-bar-fill" [style.width.%]="pct('med')"></div></div>
        </div>
        <div class="metric metric-low">
          <div class="metric-label">Normal</div>
          <div class="metric-value">{{ stats?.low || 0 | number }}</div>
          <div class="metric-bar"><div class="metric-bar-fill" [style.width.%]="pct('low')"></div></div>
        </div>
        <div class="metric metric-pending" *ngIf="stats && stats.unprocessed > 0">
          <div class="metric-label">Pending</div>
          <div class="metric-value">{{ stats.unprocessed | number }}</div>
          <div class="metric-sub">awaiting AI</div>
        </div>
      </section>

      <!-- Main content -->
      <div class="content">
        <main class="main">
          <div class="main-toolbar">
            <div class="tabs">
              <button class="tab" [class.tab-active]="!onlyAnomalies" (click)="setFilter(false)">
                All incidents
              </button>
              <button class="tab" [class.tab-active]="onlyAnomalies" (click)="setFilter(true)">
                Anomalies
                <span class="tab-count">{{ (stats?.critical || 0) + (stats?.high || 0) + (stats?.med || 0) }}</span>
              </button>
            </div>
            <div class="toolbar-right">
              <span class="result-count">Showing {{ incidents.length }}</span>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width: 80px;">Severity</th>
                  <th style="width: 140px;">Time</th>
                  <th style="width: 160px;">Source</th>
                  <th>Log</th>
                  <th style="width: 280px;">AI Analysis</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let e of incidents" [ngClass]="'row-' + (e.severity || 'unknown')">
                  <td>
                    <span class="badge" [ngClass]="'badge-' + (e.severity || 'unknown')">
                      {{ e.severity || '—' }}
                    </span>
                  </td>
                  <td class="time-cell">{{ e.timestamp | slice:5:19 }}</td>
                  <td class="source-cell">
                    <span class="source-pill">{{ e.source || 'unknown' }}</span>
                  </td>
                  <td class="log-cell">{{ e.raw_log }}</td>
                  <td class="explanation-cell">
                    <span *ngIf="e.explanation && e.explanation !== '(normal)'">{{ e.explanation }}</span>
                    <span *ngIf="!e.explanation || e.explanation === '(normal)'" class="muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div *ngIf="incidents.length === 0" class="empty">No incidents to show.</div>
          </div>
        </main>

        <!-- Chat panel -->
        <aside class="chat">
          <div class="chat-header">
            <div class="chat-title">
              <span class="chat-icon">✦</span>
              <div>
                <div class="chat-name">Ask your logs</div>
                <div class="chat-sub">RAG over {{ stats?.total || 0 | number }} incidents</div>
              </div>
            </div>
          </div>

          <div class="chat-messages">
            <div *ngIf="messages.length === 0" class="chat-empty">
              <div class="chat-empty-label">Try asking</div>
              <button class="chip" (click)="askPreset('Show me the most concerning incidents')">
                Show me the most concerning incidents
              </button>
              <button class="chip" (click)="askPreset('Are there any block replication issues?')">
                Block replication issues?
              </button>
              <button class="chip" (click)="askPreset('What patterns do you see in the errors?')">
                What patterns do you see in the errors?
              </button>
            </div>

            <div *ngFor="let msg of messages" class="message" [ngClass]="'message-' + msg.role">
              <div class="bubble">
                <div *ngIf="msg.loading" class="loading">
                  <span></span><span></span><span></span>
                </div>
                <div *ngIf="!msg.loading" class="bubble-text">{{ msg.text }}</div>
                <div *ngIf="msg.sources && msg.sources.length > 0" class="sources">
                  <div class="sources-label">{{ msg.sources.length }} source{{ msg.sources.length === 1 ? '' : 's' }}</div>
                  <div *ngFor="let s of msg.sources" class="source-item">
                    <span class="badge badge-sm" [ngClass]="'badge-' + (s.severity || 'unknown')">{{ s.severity || '—' }}</span>
                    <span class="source-id">#{{ s.id }}</span>
                    <span class="source-log">{{ s.raw_log | slice:0:64 }}…</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="chat-input">
            <input
              type="text"
              [(ngModel)]="question"
              (keyup.enter)="ask()"
              [disabled]="asking"
              placeholder="Ask anything about your logs…"
            />
            <button (click)="ask()" [disabled]="asking || !question.trim()" class="send-btn">
              <span *ngIf="!asking">→</span>
              <span *ngIf="asking">…</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    :host {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --border: #e5e7eb;
      --border-strong: #d1d5db;
      --text: #111827;
      --text-muted: #6b7280;
      --text-faint: #9ca3af;
      --brand: #4f46e5;
      --brand-soft: #eef2ff;
      --crit: #dc2626;
      --crit-soft: #fef2f2;
      --high: #ea580c;
      --high-soft: #fff7ed;
      --med: #d97706;
      --med-soft: #fffbeb;
      --low: #6b7280;
      --low-soft: #f3f4f6;
      --ok: #10b981;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04);
    }

    * { box-sizing: border-box; }

    .app {
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
    }

    /* Top nav */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark {
      width: 32px; height: 32px;
      background: var(--brand);
      color: white;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.02em;
    }
    .brand-name { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
    .brand-sub { font-size: 11px; color: var(--text-muted); }
    .topbar-right { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
    .status-dot {
      width: 7px; height: 7px;
      background: var(--ok);
      border-radius: 50%;
      box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
      50% { box-shadow: 0 0 0 6px rgba(16,185,129,0.05); }
    }
    .status-text { font-weight: 500; color: var(--text); }

    /* Metrics */
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1px;
      background: var(--border);
      border-bottom: 1px solid var(--border);
    }
    .metric {
      background: var(--surface);
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metric-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    .metric-value {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .metric-sub { font-size: 11px; color: var(--text-faint); }
    .metric-bar {
      height: 3px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }
    .metric-bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }
    .metric-critical .metric-value { color: var(--crit); }
    .metric-critical .metric-bar-fill { background: var(--crit); }
    .metric-high .metric-value { color: var(--high); }
    .metric-high .metric-bar-fill { background: var(--high); }
    .metric-med .metric-value { color: var(--med); }
    .metric-med .metric-bar-fill { background: var(--med); }
    .metric-low .metric-bar-fill { background: var(--low); }
    .metric-pending .metric-value { color: var(--brand); }

    /* Content */
    .content { flex: 1; display: grid; grid-template-columns: 1fr 380px; min-height: 0; }

    .main {
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-right: 1px solid var(--border);
      min-width: 0;
    }
    .main-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .tabs { display: flex; gap: 4px; }
    .tab {
      background: none;
      border: none;
      padding: 6px 12px;
      font-size: 13px;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 6px;
      font-weight: 500;
      display: flex; align-items: center; gap: 8px;
    }
    .tab:hover { background: var(--low-soft); color: var(--text); }
    .tab-active { background: var(--brand-soft); color: var(--brand); }
    .tab-count {
      background: rgba(79, 70, 229, 0.15);
      color: var(--brand);
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .result-count { font-size: 12px; color: var(--text-faint); }

    .table-wrap { flex: 1; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    thead { position: sticky; top: 0; background: var(--surface); z-index: 1; }
    th {
      text-align: left;
      padding: 8px 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      vertical-align: top;
      line-height: 1.5;
    }
    tbody tr:hover { background: var(--bg); }
    .row-critical { background: rgba(220, 38, 38, 0.03); }
    .row-critical:hover { background: rgba(220, 38, 38, 0.06); }
    .row-high { background: rgba(234, 88, 12, 0.025); }
    .row-high:hover { background: rgba(234, 88, 12, 0.05); }
    .row-med { background: rgba(217, 119, 6, 0.02); }
    .row-med:hover { background: rgba(217, 119, 6, 0.04); }

    .time-cell { font-variant-numeric: tabular-nums; color: var(--text-muted); font-size: 11px; }
    .source-pill {
      display: inline-block;
      padding: 1px 8px;
      background: var(--low-soft);
      color: var(--text);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .log-cell {
      font-family: 'SF Mono', Menlo, Consolas, monospace;
      font-size: 11px;
      color: var(--text);
      max-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .explanation-cell { color: var(--text); font-size: 12px; }
    .muted { color: var(--text-faint); }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge-sm { padding: 1px 6px; font-size: 9px; }
    .badge-critical { background: var(--crit-soft); color: var(--crit); }
    .badge-high { background: var(--high-soft); color: var(--high); }
    .badge-med { background: var(--med-soft); color: var(--med); }
    .badge-low { background: var(--low-soft); color: var(--low); }
    .badge-unknown { background: var(--low-soft); color: var(--text-faint); }

    .empty { padding: 60px; text-align: center; color: var(--text-faint); }

    /* Chat panel */
    .chat {
      display: flex;
      flex-direction: column;
      background: var(--surface);
      min-width: 0;
    }
    .chat-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    .chat-title { display: flex; gap: 10px; align-items: center; }
    .chat-icon {
      width: 28px; height: 28px;
      background: linear-gradient(135deg, var(--brand), #7c3aed);
      color: white;
      border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px;
    }
    .chat-name { font-weight: 600; font-size: 13px; }
    .chat-sub { font-size: 11px; color: var(--text-muted); }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .chat-empty { display: flex; flex-direction: column; gap: 6px; }
    .chat-empty-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .chip {
      text-align: left;
      padding: 9px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 12px;
      color: var(--text);
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }
    .chip:hover {
      background: var(--brand-soft);
      border-color: var(--brand);
      color: var(--brand);
    }

    .message { display: flex; }
    .message-user { justify-content: flex-end; }
    .bubble {
      max-width: 90%;
      padding: 9px 12px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.55;
    }
    .message-user .bubble {
      background: var(--brand);
      color: white;
      border-bottom-right-radius: 4px;
    }
    .message-assistant .bubble {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }
    .bubble-text { white-space: pre-wrap; }

    .loading { display: flex; gap: 3px; padding: 4px 0; }
    .loading span {
      width: 6px; height: 6px;
      background: var(--text-faint);
      border-radius: 50%;
      animation: bounce 1.4s ease-in-out infinite;
    }
    .loading span:nth-child(2) { animation-delay: 0.16s; }
    .loading span:nth-child(3) { animation-delay: 0.32s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
      40% { transform: scale(1); opacity: 1; }
    }

    .sources {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    .sources-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
      margin-bottom: 6px;
    }
    .source-item {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 4px;
      font-size: 11px;
    }
    .source-id { color: var(--text-muted); font-weight: 600; font-variant-numeric: tabular-nums; }
    .source-log {
      color: var(--text-faint);
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }

    .chat-input {
      padding: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
    }
    .chat-input input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .chat-input input:focus {
      border-color: var(--brand);
      box-shadow: 0 0 0 3px var(--brand-soft);
    }
    .send-btn {
      width: 36px;
      background: var(--brand);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .send-btn:hover:not(:disabled) { background: #4338ca; }
    .send-btn:disabled { background: var(--border-strong); cursor: not-allowed; }
  `]
})
export class AppComponent implements OnInit {
  incidents: Incident[] = [];
  stats: Stats | null = null;
  onlyAnomalies = false;

  messages: ChatMessage[] = [];
  question = '';
  asking = false;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.refresh();
      setInterval(() => this.refresh(), 5000);
    }
  }

  refresh() {
    this.loadIncidents();
    this.loadStats();
  }

  setFilter(only: boolean) {
    this.onlyAnomalies = only;
    this.loadIncidents();
  }

  loadIncidents() {
    const url = `http://${environment.apiBaseUrl}/incidents?limit=200${this.onlyAnomalies ? '&only_anomalies=true' : ''}`;
    this.http.get<Incident[]>(url).subscribe({
      next: data => this.incidents = data,
      error: err => console.error('Error loading incidents:', err)
    });
  }

  loadStats() {
    this.http.get<Stats>('http://${environment.apiBaseUrl}/incidents/stats').subscribe({
      next: data => this.stats = data,
      error: err => console.error('Error loading stats:', err)
    });
  }

  pct(severity: 'critical' | 'high' | 'med' | 'low'): number {
    if (!this.stats || !this.stats.total) return 0;
    const v = this.stats[severity];
    return Math.min(100, (v / this.stats.total) * 100);
  }

  askPreset(text: string) {
    this.question = text;
    this.ask();
  }

  ask() {
    const q = this.question.trim();
    if (!q || this.asking) return;

    this.messages.push({ role: 'user', text: q });
    const placeholder: ChatMessage = { role: 'assistant', text: '', loading: true };
    this.messages.push(placeholder);

    this.question = '';
    this.asking = true;

    this.http.post<{ answer: string; sources: ChatSource[] }>(
      'http://${environment.apiBaseUrl}/chat',
      { question: q }
    ).subscribe({
      next: res => {
        placeholder.text = res.answer;
        placeholder.sources = res.sources;
        placeholder.loading = false;
        this.asking = false;
      },
      error: err => {
        placeholder.text = `Error: ${err.error?.detail || err.message}`;
        placeholder.loading = false;
        this.asking = false;
      }
    });
  }
}