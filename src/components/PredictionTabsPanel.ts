import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { CommodityQuote } from '@/services/alpha-vantage-commodities';

type PredictionTabId = 'markets' | 'intel' | 'correlations' | 'predictions';

export class PredictionTabsPanel extends Panel {
  private activeTab: PredictionTabId = 'markets';
  private latestQuotes: CommodityQuote[] = [];

  constructor() {
    super({
      id: 'prediction-tabs',
      title: t('panels.predictionTabs') || 'Prédiction Commodités',
      infoTooltip:
        t('components.predictionTabs.infoTooltip') ||
        'Outil de prédiction basé sur les événements mondiaux en temps réel.',
    });

    this.renderTabsSkeleton();
    this.attachTabHandlers();
  }

  public setCommodityQuotes(quotes: CommodityQuote[]): void {
    this.latestQuotes = quotes;
    if (this.activeTab === 'markets') {
      this.renderMarketsTab();
    }
  }

  private renderTabsSkeleton(): void {
    const html = `
      <div class="prediction-tabs-root">
        <div class="prediction-tabs-header">
          ${this.renderTabButton('markets', 'Marchés')}
          ${this.renderTabButton('intel', 'Intelligence mondiale')}
          ${this.renderTabButton('correlations', 'Corrélations')}
          ${this.renderTabButton('predictions', 'Prédictions')}
        </div>
        <div class="prediction-tabs-body" data-tab-body>
          ${this.renderMarketsContent()}
        </div>
      </div>
    `;
    this.setContent(html);
  }

  private renderTabButton(id: PredictionTabId, label: string): string {
    const isActive = this.activeTab === id;
    return `
      <button
        class="prediction-tab-btn ${isActive ? 'active' : ''}"
        data-tab-id="${id}"
        type="button"
      >
        ${label}
      </button>
    `;
  }

  private attachTabHandlers(): void {
    const root = this.getElement();
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tabId = target.getAttribute('data-tab-id') as PredictionTabId | null;
      if (!tabId || tabId === this.activeTab) return;

      this.activeTab = tabId;
      this.updateActiveTab();
    });
  }

  private updateActiveTab(): void {
    const root = this.getElement();
    const buttons = root.querySelectorAll<HTMLButtonElement>('.prediction-tab-btn');
    buttons.forEach((btn) => {
      const id = btn.getAttribute('data-tab-id');
      btn.classList.toggle('active', id === this.activeTab);
    });

    const body = root.querySelector<HTMLElement>('[data-tab-body]');
    if (!body) return;

    if (this.activeTab === 'markets') {
      body.innerHTML = this.renderMarketsContent();
    } else if (this.activeTab === 'intel') {
      body.innerHTML =
        '<div class="prediction-tab-placeholder">Section Intelligence mondiale – à implémenter.</div>';
    } else if (this.activeTab === 'correlations') {
      body.innerHTML =
        '<div class="prediction-tab-placeholder">Section Corrélations – à implémenter.</div>';
    } else if (this.activeTab === 'predictions') {
      body.innerHTML =
        '<div class="prediction-tab-placeholder">Section Prédictions – à implémenter.</div>';
    }
  }

  private renderMarketsTab(): void {
    const root = this.getElement();
    const body = root.querySelector<HTMLElement>('[data-tab-body]');
    if (!body) return;
    body.innerHTML = this.renderMarketsContent();
  }

  private renderMarketsContent(): string {
    if (!this.latestQuotes.length) {
      return `<div class="prediction-markets-empty">
        Aucune donnée de marché pour l'instant (service Alpha Vantage en mode maquette).
      </div>`;
    }

    const rows = this.latestQuotes.map((q) => {
      const class1h = this.getChangeClass(q.change1hPct);
      const class4h = this.getChangeClass(q.change4hPct);
      const class24h = this.getChangeClass(q.change24hPct);

      return `
        <tr>
          <td>${q.displayName}</td>
          <td class="numeric">${q.currentPrice != null ? q.currentPrice.toFixed(2) : '—'}</td>
          <td class="numeric ${class1h}">
            ${this.formatChangePercent(q.change1hPct)}
          </td>
          <td class="numeric ${class4h}">
            ${this.formatChangePercent(q.change4hPct)}
          </td>
          <td class="numeric ${class24h}">
            ${this.formatChangePercent(q.change24hPct)}
          </td>
        </tr>
      `;
    });

    return `
      <div class="prediction-markets">
        <table class="prediction-markets-table">
          <thead>
            <tr>
              <th>Commodité</th>
              <th>Prix actuel</th>
              <th>Δ 1h</th>
              <th>Δ 4h</th>
              <th>Δ 24h</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
        <div class="prediction-markets-legend">
          <span class="legend-up">▲ hausse</span>
          <span class="legend-down">▼ baisse</span>
        </div>
      </div>
    `;
  }

  private getChangeClass(value: number | null): string {
    if (value == null) return '';
    if (value > 0) return 'change-up';
    if (value < 0) return 'change-down';
    return '';
  }

  private formatChangePercent(value: number | null): string {
    if (value == null) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)} %`;
  }
}
