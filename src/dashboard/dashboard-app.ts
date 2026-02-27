import { PredictionTabsPanel } from '@/components/PredictionTabsPanel';
import { getAllCommodityQuotesMock } from '@/services/alpha-vantage-commodities';
import { initI18n } from '@/services/i18n';

export async function initDashboardApp(containerId: string): Promise<void> {
  await initI18n();

  const el = document.getElementById(containerId);
  if (!el) throw new Error(`Container ${containerId} not found for dashboard`);

  el.innerHTML = `
    <div class="prediction-dashboard-root">
      <header class="prediction-dashboard-header">
        <h1 class="prediction-dashboard-title">Commodity Prediction Dashboard</h1>
        <p class="prediction-dashboard-subtitle">
          Commodity markets analysis, global intelligence, correlations and predictions.
        </p>
        <div class="prediction-dashboard-nav">
          <a href="/" class="prediction-dashboard-link">← Back to WorldMonitor</a>
        </div>
      </header>
      <main class="prediction-dashboard-main">
        <div id="predictionTabsMount"></div>
      </main>
    </div>
  `;

  const mount = document.getElementById('predictionTabsMount');
  if (!mount) return;

  const panel = new PredictionTabsPanel();
  mount.appendChild(panel.getElement());

  const quotes = await getAllCommodityQuotesMock();
  panel.setCommodityQuotes(quotes);
}
