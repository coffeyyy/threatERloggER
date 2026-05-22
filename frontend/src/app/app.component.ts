import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';

interface Incident {
  id: number;
  timestamp: string;
  raw_log: string;
  source: string;
  severity: string | null;
  explanation: string | null;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule, MatTableModule],
  template: `
    <div style="padding: 20px;">
      <h1>Sentinel - Log Anomaly Detection</h1>
      <table mat-table [dataSource]="incidents" style="width: 100%; border-collapse: collapse;">
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
          <td mat-cell *matCellDef="let e">{{ e.raw_log | slice:0:80 }}...</td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
      </table>
    </div>
  `,
  styles: [`
    table { border: 1px solid #ddd; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
  `]
})
export class AppComponent implements OnInit {
  incidents: Incident[] = [];
  displayedColumns = ['timestamp', 'source', 'raw_log'];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadIncidents();
    // Poll every 5 seconds
    setInterval(() => this.loadIncidents(), 5000);
  }

  loadIncidents() {
    this.http.get<Incident[]>('http://localhost:8000/incidents?limit=50')
      .subscribe(
        data => this.incidents = data,
        error => console.error('Error loading incidents:', error)
      );
  }
}