/**
 * Control bar for the live map, mirroring the 3D view's bar so the two halves of
 * live mode share one control language. It replaces Leaflet's own zoom control,
 * which sits under the HUD panel in the top-left corner.
 *
 * Labels collapse to icons on narrow screens (see `.lv-bar` in style.css).
 */
export function LiveMapControls({
  onZoomIn,
  onZoomOut,
  onOverview,
  onEnter3D,
  canZoomIn,
  canZoomOut
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOverview: () => void;
  onEnter3D: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}) {
  return (
    <div className="lv-bar">
      <button className="lv-bar-btn lv-bar-icon" onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button className="lv-bar-btn lv-bar-icon" onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in" title="Zoom in">
        +
      </button>
      <button className="lv-bar-btn" onClick={onOverview} title="Back to the whole network">
        <span aria-hidden="true">⤢</span>
        <span className="lv-bar-label">Overview</span>
      </button>
      <button className="lv-bar-btn" onClick={onEnter3D} title="Switch to the 3D view">
        <span aria-hidden="true">⛶</span>
        <span className="lv-bar-label">3D view</span>
      </button>
      <span className="lv-bar-hint">scroll to zoom · click a vehicle to select</span>
    </div>
  );
}
