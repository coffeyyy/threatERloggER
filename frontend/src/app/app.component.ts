import { Component, OnInit, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';

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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule],
  template: `
    <div class="app">
      <main class="main">
        <header>
          <h1>Sentinel</h1>
          <span class="subtitle">Log Anomaly Detection</span>
          <div class="filter">
            <label>
              <input type="checkbox" [checked]="onlyAnomalies" (change)="toggleAnomalies()" />
              Anomalies only
            </label>
            <span class="count">{{ incidents.length }} incidents</span>
          </div>
        </header>

        <table mat-table [dataSource]="incidents">
          <ng-container matColumnDef="severity">
            <th mat-header-cell *matHeaderCellDef>Severity</th>
            <td mat-cell *matCellDef="let e">
              <span class="badge" [ngClass]="'badge-' + (e.severity || 'unknown')">
                {{ e.severity || '—' }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="timestamp">
            <th mat-header-cell *matHeaderCellDef>Time</th>
            <td mat-cell *matCellDef="let e">{{ e.timestamp | slice:0:19 }}</td>
          </ng-container>

          <ng-container matColumnDef="source">
            <th mat-header-cell *matHeaderCellDef>Source</th>
            <td mat-cell *matCellDef="let e">{{ e.source }}</td>
          </ng-container>

          <ng-container matColumnDef="raw_log">
            <th mat-header-cell *matHeaderCellDef>Log</th>
            <td mat-cell *matCellDef="let e" class="log-cell">{{ e.raw_log }}</td>
          </ng-container>

          <ng-container matColumnDef="explanation">
            <th mat-header-cell *matHeaderCellDef>AI Explanation</th>
            <td mat-cell *matCellDef="let e" class="explanation-cell">
              <span *ngIf="e.explanation && e.explanation !== '(normal)'">{{ e.explanation }}</span>
              <span *ngIf="!e.explanation || e.explanation === '(normal)'" class="muted">—</span>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"
              [ngClass]="'row-' + (row.severity || 'unknown')"></tr>
        </table>

        <div *ngIf="incidents.length === 0" class="empty">No incidents yet.</div>
      </main>

      <aside class="chat">
        <div class="chat-header">
          <h2>Ask your logs</h2>
          <span class="chat-subtitle">Natural-language search over incidents</span>
        </div>

        <div class="chat-messages" #messagesContainer>
          <div *ngIf="messages.length === 0" class="chat-empty">
            <p>Try asking:</p>
            <ul>
              <li (click)="askPreset('Show me the most concerning incidents')">
                "Show me the most concerning incidents"
              </li>
              <li (click)="askPreset('Are there any block replication issues?')">
                "Are there any block replication issues?"
              </li>
              <li (click)="askPreset('Summarize what happened today')">
                "Summarize what happened today"
              </li>
            </ul>
          </div>

          <div *ngFor="let msg of messages" class="message" [ngClass]="'message-' + msg.role">
            <div class="message-bubble">
              <div *ngIf="msg.loading" class="loading">Thinking…</div>
              <div *ngIf="!msg.loading" class="message-text">{{ msg.text }}</div>
              <div *ngIf="msg.sources && msg.sources.length > 0" class="sources">
                <div class="sources-label">Sources</div>
                <div *ngFor="let s of msg.sources" class="source-item">
                  <span class="badge badge-sm" [ngClass]="'badge-' + (s.severity || 'unknown')">
                    {{ s.severity || '—' }}
                  </span>
                  <span class="source-id">#{{ s.id }}</span>
                  <span class="source-log">{{ s.raw_log | slice:0:80 }}…</span>
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
            placeholder="Ask about your logs…"
          />
          <button (click)="ask()" [disabled]="asking || !question.trim()">Send</button>
        </div>
      </aside>
    </div>
  `,
  styles: [`
    .app { display: grid; grid-template-columns: 1fr 380px; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .main { padding: 24px; overflow-y: auto; }
    header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 28px; }
    .subtitle { color: #666; font-size: 14px; }
    .filter { margin-left: auto; display: flex; gap: 16px; align-items: center; font-size: 13px; color: #555; }
    .filter label { display: flex; gap: 6px; cursor: pointer; }
    .count { color: #888; }

    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
    th { background: #fafafa; font-weight: 600; color: #444; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .log-cell { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .explanation-cell { max-width: 320px; }
    .muted { color: #bbb; }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-sm { padding: 1px 6px; font-size: 10px; }
    .badge-critical { background: #fee; color: #c00; }
    .badge-high { background: #fed; color: #b50; }
    .badge-med { background: #ffd; color: #960; }
    .badge-low { background: #f0f0f0; color: #888; }
    .badge-unknown { background: #f4f4f4; color: #aaa; }

    .row-critical { background: rgba(255, 0, 0, 0.03); }
    .row-high { background: rgba(255, 100, 0, 0.025); }
    .row-med { background: rgba(255, 200, 0, 0.02); }

    .empty { padding: 40px; text-align: center; color: #999; }

    /* Chat panel */
    .chat { border-left: 1px solid #e5e5e5; background: #fafafa; display: flex; flex-direction: column; }
    .chat-header { padding: 20px; border-bottom: 1px solid #e5e5e5; background: white; }
    .chat-header h2 { margin: 0 0 4px; font-size: 18px; }
    .chat-subtitle { color: #888; font-size: 12px; }

    .chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .chat-empty { color: #999; font-size: 13px; }
    .chat-empty ul { list-style: none; padding: 0; margin: 8px 0 0; }
    .chat-empty li { padding: 8px 12px; background: white; border: 1px solid #e5e5e5; border-radius: 8px; margin-bottom: 6px; cursor: pointer; font-style: italic; }
    .chat-empty li:hover { background: #f0f7ff; border-color: #b0d0f0; }

    .message { display: flex; }
    .message-user { justify-content: flex-end; }
    .message-bubble { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
    .message-user .message-bubble { background: #2563eb; color: white; }
    .message-assistant .message-bubble { background: white; border: 1px solid #e5e5e5; color: #222; }
    .loading { color: #999; font-style: italic; }
    .message-text { white-space: pre-wrap; }

    .sources { margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee; }
    .sources-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 6px; }
    .source-item { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; font-size: 11px; }
    .source-id { color: #666; font-weight: 600; }
    .source-log { color: #888; font-family: 'SF Mono', Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .chat-input { padding: 12px; border-top: 1px solid #e5e5e5; background: white; display: flex; gap: 8px; }
    .chat-input input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; outline: none; }
    .chat-input input:focus { border-color: #2563eb; }
    .chat-input button { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .chat-input button:disabled { background: #ccc; cursor: not-allowed; }
  `]
})
export class AppComponent implements OnInit {
  incidents: Incident[] = [];
  displayedColumns = ['severity', 'timestamp', 'source', 'raw_log', 'explanation'];
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
      this.loadIncidents();
      setInterval(() => this.loadIncidents(), 5000);
    }
  }

  toggleAnomalies() {
    this.onlyAnomalies = !this.onlyAnomalies;
    this.loadIncidents();
  }

  loadIncidents() {
    const url = `http://localhost:8000/incidents?limit=100${this.onlyAnomalies ? '&only_anomalies=true' : ''}`;
    this.http.get<Incident[]>(url).subscribe({
      next: data => this.incidents = data,
      error: error => console.error('Error loading incidents:', error)
    });
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
      'http://localhost:8000/chat',
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