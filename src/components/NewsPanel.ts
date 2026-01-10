import { Panel } from './Panel';
import type { NewsItem, ClusteredEvent, DeviationLevel, RelatedAsset, RelatedAssetContext } from '@/types';
import { formatTime } from '@/utils';
import { clusterNews, enrichWithVelocity, getClusterAssetContext, getAssetLabel, MAX_DISTANCE_KM } from '@/services';

export class NewsPanel extends Panel {
  private clusteredMode = true;
  private deviationEl: HTMLElement | null = null;
  private relatedAssetContext = new Map<string, RelatedAssetContext>();
  private onRelatedAssetClick?: (asset: RelatedAsset) => void;
  private onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
  private onRelatedAssetsClear?: () => void;

  constructor(id: string, title: string) {
    super({ id, title, showCount: true });
    this.createDeviationIndicator();
  }

  public setRelatedAssetHandlers(options: {
    onRelatedAssetClick?: (asset: RelatedAsset) => void;
    onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
    onRelatedAssetsClear?: () => void;
  }): void {
    this.onRelatedAssetClick = options.onRelatedAssetClick;
    this.onRelatedAssetsFocus = options.onRelatedAssetsFocus;
    this.onRelatedAssetsClear = options.onRelatedAssetsClear;
  }

  private createDeviationIndicator(): void {
    const header = this.getElement().querySelector('.panel-header-left');
    if (header) {
      this.deviationEl = document.createElement('span');
      this.deviationEl.className = 'deviation-indicator';
      header.appendChild(this.deviationEl);
    }
  }

  public setDeviation(zScore: number, percentChange: number, level: DeviationLevel): void {
    if (!this.deviationEl) return;

    if (level === 'normal') {
      this.deviationEl.textContent = '';
      this.deviationEl.className = 'deviation-indicator';
      return;
    }

    const arrow = zScore > 0 ? '↑' : '↓';
    const sign = percentChange > 0 ? '+' : '';
    this.deviationEl.textContent = `${arrow}${sign}${percentChange}%`;
    this.deviationEl.className = `deviation-indicator ${level}`;
    this.deviationEl.title = `z-score: ${zScore} (vs 7-day avg)`;
  }

  public renderNews(items: NewsItem[]): void {
    if (items.length === 0) {
      this.showError('No news available');
      return;
    }

    if (this.clusteredMode) {
      const clusters = clusterNews(items);
      const enriched = enrichWithVelocity(clusters);
      this.renderClusters(enriched);
    } else {
      this.renderFlat(items);
    }
  }

  private renderFlat(items: NewsItem[]): void {
    this.setCount(items.length);

    const html = items
      .map(
        (item) => `
      <div class="item ${item.isAlert ? 'alert' : ''}" ${item.monitorColor ? `style="border-left-color: ${item.monitorColor}"` : ''}>
        <div class="item-source">
          ${item.source}
          ${item.isAlert ? '<span class="alert-tag">ALERT</span>' : ''}
        </div>
        <a class="item-title" href="${item.link}" target="_blank" rel="noopener">${item.title}</a>
        <div class="item-time">${formatTime(item.pubDate)}</div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
  }

  private renderClusters(clusters: ClusteredEvent[]): void {
    const totalItems = clusters.reduce((sum, c) => sum + c.sourceCount, 0);
    this.setCount(totalItems);
    this.relatedAssetContext.clear();

    const html = clusters
      .map((cluster) => {
        const sourceBadge = cluster.sourceCount > 1
          ? `<span class="source-count">${cluster.sourceCount} sources</span>`
          : '';

        const velocity = cluster.velocity;
        const velocityBadge = velocity && velocity.level !== 'normal' && cluster.sourceCount > 1
          ? `<span class="velocity-badge ${velocity.level}">${velocity.trend === 'rising' ? '↑' : ''}+${velocity.sourcesPerHour}/hr</span>`
          : '';

        const sentimentIcon = velocity?.sentiment === 'negative' ? '⚠' : velocity?.sentiment === 'positive' ? '✓' : '';
        const sentimentBadge = sentimentIcon && Math.abs(velocity?.sentimentScore || 0) > 2
          ? `<span class="sentiment-badge ${velocity?.sentiment}">${sentimentIcon}</span>`
          : '';

        const topSourcesHtml = cluster.topSources
          .map(s => `<span class="top-source tier-${s.tier}">${s.name}</span>`)
          .join('');

        const assetContext = getClusterAssetContext(cluster);
        if (assetContext && assetContext.assets.length > 0) {
          this.relatedAssetContext.set(cluster.id, assetContext);
        }

        const relatedAssetsHtml = assetContext && assetContext.assets.length > 0
          ? `
            <div class="related-assets" data-cluster-id="${cluster.id}">
              <div class="related-assets-header">
                Related assets near ${assetContext.origin.label}
                <span class="related-assets-range">(${MAX_DISTANCE_KM}km)</span>
              </div>
              <div class="related-assets-list">
                ${assetContext.assets.map(asset => `
                  <button class="related-asset" data-cluster-id="${cluster.id}" data-asset-id="${asset.id}" data-asset-type="${asset.type}">
                    <span class="related-asset-type">${getAssetLabel(asset.type)}</span>
                    <span class="related-asset-name">${asset.name}</span>
                    <span class="related-asset-distance">${Math.round(asset.distanceKm)}km</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `
          : '';

        return `
      <div class="item clustered ${cluster.isAlert ? 'alert' : ''}" ${cluster.monitorColor ? `style="border-left-color: ${cluster.monitorColor}"` : ''} data-cluster-id="${cluster.id}">
        <div class="item-source">
          ${cluster.primarySource}
          ${sourceBadge}
          ${velocityBadge}
          ${sentimentBadge}
          ${cluster.isAlert ? '<span class="alert-tag">ALERT</span>' : ''}
        </div>
        <a class="item-title" href="${cluster.primaryLink}" target="_blank" rel="noopener">${cluster.primaryTitle}</a>
        <div class="cluster-meta">
          <span class="top-sources">${topSourcesHtml}</span>
          <span class="item-time">${formatTime(cluster.lastUpdated)}</span>
        </div>
        ${relatedAssetsHtml}
      </div>
    `;
      })
      .join('');

    this.setContent(html);
    this.bindRelatedAssetEvents();
  }

  private bindRelatedAssetEvents(): void {
    const containers = this.content.querySelectorAll<HTMLDivElement>('.related-assets');
    containers.forEach((container) => {
      const clusterId = container.dataset.clusterId;
      if (!clusterId) return;
      const context = this.relatedAssetContext.get(clusterId);
      if (!context) return;

      container.addEventListener('mouseenter', () => {
        this.onRelatedAssetsFocus?.(context.assets, context.origin.label);
      });

      container.addEventListener('mouseleave', () => {
        this.onRelatedAssetsClear?.();
      });
    });

    const assetButtons = this.content.querySelectorAll<HTMLButtonElement>('.related-asset');
    assetButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const clusterId = button.dataset.clusterId;
        const assetId = button.dataset.assetId;
        const assetType = button.dataset.assetType as RelatedAsset['type'] | undefined;
        if (!clusterId || !assetId || !assetType) return;
        const context = this.relatedAssetContext.get(clusterId);
        const asset = context?.assets.find(item => item.id === assetId && item.type === assetType);
        if (asset) {
          this.onRelatedAssetClick?.(asset);
        }
      });
    });
  }
}
