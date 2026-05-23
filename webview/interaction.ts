/** Pan and mouse-wheel zoom for the graph canvas, via a CSS transform. */
import { clampZoom } from '../src/model/layout';

export interface Transform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface WorldBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Pointer movement (px) above which a gesture counts as a pan, not a click. */
const PAN_CLICK_THRESHOLD = 4;

export class PanZoom {
  public transform: Transform = { zoom: 1, panX: 0, panY: 0 };
  public onChange: (() => void) | null = null;

  private panning = false;
  private moved = false;
  private startX = 0;
  private startY = 0;
  private startPanX = 0;
  private startPanY = 0;
  private suppressClick = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly world: HTMLElement
  ) {
    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('pointermove', this.onPointerMove);
    stage.addEventListener('pointerup', this.onPointerUp);
    stage.addEventListener('pointercancel', this.onPointerUp);
    stage.addEventListener('wheel', this.onWheel, { passive: false });
  }

  apply(): void {
    const t = this.transform;
    this.world.style.transform = `translate(${t.panX}px, ${t.panY}px) scale(${t.zoom})`;
  }

  setTransform(t: Transform): void {
    this.transform = { zoom: clampZoom(t.zoom), panX: t.panX, panY: t.panY };
    this.apply();
    this.onChange?.();
  }

  /** Returns true once if the last gesture was a pan, so the click is ignored. */
  consumeSuppressedClick(): boolean {
    if (this.suppressClick) {
      this.suppressClick = false;
      return true;
    }
    return false;
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.stage.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const z = this.transform.zoom;
    const nz = clampZoom(z * factor);
    if (nz === z) {
      return;
    }
    const worldX = (sx - this.transform.panX) / z;
    const worldY = (sy - this.transform.panY) / z;
    this.transform.zoom = nz;
    this.transform.panX = sx - worldX * nz;
    this.transform.panY = sy - worldY * nz;
    this.apply();
    this.onChange?.();
  }

  zoomByCentered(factor: number): void {
    const rect = this.stage.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  fitToWorldBox(box: WorldBox, maxZoom = 1.4): void {
    const bw = Math.max(1, box.maxX - box.minX);
    const bh = Math.max(1, box.maxY - box.minY);
    const sw = this.stage.clientWidth || 800;
    const sh = this.stage.clientHeight || 600;
    let zoom = Math.min(sw / bw, sh / bh) * 0.85;
    zoom = Math.min(maxZoom, clampZoom(zoom));
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    this.transform.zoom = zoom;
    this.transform.panX = sw / 2 - zoom * cx;
    this.transform.panY = sh / 2 - zoom * cy;
    this.apply();
    this.onChange?.();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.node')) {
      return;
    }
    this.panning = true;
    this.moved = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startPanX = this.transform.panX;
    this.startPanY = this.transform.panY;
    this.stage.setPointerCapture(e.pointerId);
    this.stage.classList.add('is-panning');
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.panning) {
      return;
    }
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (Math.abs(dx) > PAN_CLICK_THRESHOLD || Math.abs(dy) > PAN_CLICK_THRESHOLD) {
      this.moved = true;
    }
    this.transform.panX = this.startPanX + dx;
    this.transform.panY = this.startPanY + dy;
    this.apply();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.panning) {
      return;
    }
    this.panning = false;
    this.suppressClick = this.moved;
    try {
      this.stage.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture already released */
    }
    this.stage.classList.remove('is-panning');
    if (this.moved) {
      this.onChange?.();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoomAt(factor, e.clientX, e.clientY);
  };
}
