import { getAllCommodityQuotesMock } from '@/services/alpha-vantage-commodities';
import type { CommodityQuote } from '@/services/alpha-vantage-commodities';
import { initI18n } from '@/services/i18n';

type SectionId = 'markets' | 'intel' | 'correlations' | 'predictions';

function getChangeClass(value: number | null): string {
  if (value == null) return '';
  if (value > 0) return 'change-up';
  if (value < 0) return 'change-down';
  return '';
}

function formatChangePercent(value: number | null): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} %`;
}

function buildMarketsTableHtml(quotes: CommodityQuote[]): string {
  if (!quotes.length) {
    return `<div class="prediction-markets-empty">
      No market data available yet (Alpha Vantage service in mock mode).
    </div>`;
  }
  const rows = quotes.map((q) => {
    const c1 = getChangeClass(q.change1hPct);
    const c4 = getChangeClass(q.change4hPct);
    const c24 = getChangeClass(q.change24hPct);
    return `
      <tr>
        <td>${q.displayName}</td>
        <td class="numeric">${q.currentPrice != null ? q.currentPrice.toFixed(2) : '—'}</td>
        <td class="numeric ${c1}">${formatChangePercent(q.change1hPct)}</td>
        <td class="numeric ${c4}">${formatChangePercent(q.change4hPct)}</td>
        <td class="numeric ${c24}">${formatChangePercent(q.change24hPct)}</td>
      </tr>`;
  });
  return `
    <div class="prediction-markets">
      <table class="prediction-markets-table">
        <thead>
          <tr>
            <th>Commodity</th>
            <th>Current price</th>
            <th>Δ 1h</th>
            <th>Δ 4h</th>
            <th>Δ 24h</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div class="prediction-markets-legend">
        <span class="legend-up">▲ up</span>
        <span class="legend-down">▼ down</span>
      </div>
    </div>`;
}

export async function initDashboardApp(containerId: string): Promise<void> {
  await initI18n();

  const el = document.getElementById(containerId);
  if (!el) throw new Error(`Container ${containerId} not found for dashboard`);

  let sidebarOpen = false;
  let currentSection: SectionId = 'markets';

  const quotes = await getAllCommodityQuotesMock();

  function renderContent(): void {
    const content = document.getElementById('dashboard-content');
    if (!content) return;
    if (currentSection === 'markets') {
      content.innerHTML = `<div class="dashboard-content-inner dashboard-content-markets">${buildMarketsTableHtml(quotes)}</div>`;
    } else if (currentSection === 'intel') {
      content.innerHTML = `
        <div class="dashboard-content-inner dashboard-content-iframe">
          <iframe
            id="dashboard-intel-iframe"
            src="https://worldmonitor.app"
            title="WorldMonitor Global Intelligence"
            class="dashboard-iframe"
          ></iframe>
        </div>`;
    } else if (currentSection === 'correlations') {
      content.innerHTML = '<div class="dashboard-content-inner prediction-tab-placeholder">Correlations section – to be implemented.</div>';
    } else {
      content.innerHTML = '<div class="dashboard-content-inner prediction-tab-placeholder">Predictions section – to be implemented.</div>';
    }
  }

  function setSection(section: SectionId): void {
    currentSection = section;
    const sidebar = document.getElementById('dashboard-sidebar');
    if (sidebar) {
      sidebar.querySelectorAll('.dashboard-nav-item').forEach((item) => {
        item.classList.toggle('active', item.getAttribute('data-section') === section);
      });
    }
    renderContent();
  }

  function toggleSidebar(): void {
    sidebarOpen = !sidebarOpen;
    const root = document.getElementById('dashboard-root');
    const sidebar = document.getElementById('dashboard-sidebar');
    if (root) root.classList.toggle('sidebar-open', sidebarOpen);
    if (sidebar) sidebar.setAttribute('aria-hidden', String(!sidebarOpen));
  }

  el.innerHTML = `
    <div id="dashboard-root" class="dashboard-root">
      <button type="button" id="dashboard-hamburger" class="dashboard-hamburger" aria-label="Toggle menu" aria-expanded="false">
        ☰
      </button>
      <aside id="dashboard-sidebar" class="dashboard-sidebar" aria-hidden="true">
        <nav class="dashboard-nav">
          <a href="#" class="dashboard-nav-item active" data-section="markets">Markets</a>
          <a href="#" class="dashboard-nav-item" data-section="intel">Global Intelligence</a>
          <a href="#" class="dashboard-nav-item" data-section="correlations">Correlations</a>
          <a href="#" class="dashboard-nav-item" data-section="predictions">Predictions</a>
        </nav>
        <div class="dashboard-sidebar-footer">
          <a href="/" class="dashboard-back-link">← Back to WorldMonitor</a>
        </div>
      </aside>
      <main id="dashboard-content" class="dashboard-content">
        <div class="dashboard-content-inner dashboard-content-markets">${buildMarketsTableHtml(quotes)}</div>
      </main>
    </div>
  `;

  const hamburger = document.getElementById('dashboard-hamburger');
  const sidebar = document.getElementById('dashboard-sidebar');

  hamburger?.addEventListener('click', () => {
    toggleSidebar();
    hamburger.setAttribute('aria-expanded', String(sidebarOpen));
  });

  sidebar?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.dashboard-nav-item');
    if (!item) return;
    e.preventDefault();
    const section = item.getAttribute('data-section') as SectionId;
    if (section) setSection(section);
  });

  document.querySelector('.dashboard-back-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/';
  });

  renderContent();
}
