import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampFinite,
  sanitizeViewport,
  type Viewport,
} from '@/lib/canvasGeometry';

// Camera of the graph canvas: pan/zoom state, wheel zoom around the cursor, smooth
// animations and conversions between screen and world coordinates.
export function useViewport(containerRef: RefObject<HTMLDivElement | null>) {
  const [viewport, setViewportState] = useState<Viewport>({ x: 400, y: 300, zoom: 1 });
  const viewportRef = useRef<Viewport>(viewport);
  viewportRef.current = viewport;

  const setViewport = useCallback(
    (updater: Viewport | ((prev: Viewport) => Viewport)) => {
      setViewportState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return sanitizeViewport(next, prev);
      });
    },
    []
  );

  // Coordinate transforms
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    const vp = viewportRef.current;
    const z = clampFinite(vp.zoom, 1, MIN_ZOOM, MAX_ZOOM);
    return {
      x: clampFinite((sx - vp.x) / z, 0),
      y: clampFinite((sy - vp.y) / z, 0),
    };
  }, []);

  // Smooth camera animation helper
  const animFrameRef = useRef<number | null>(null);
  const animateViewportTo = useCallback(
    (rawTarget: Viewport, duration = 360) => {
      const target = sanitizeViewport(rawTarget, viewportRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      const start = viewportRef.current;
      const startTime = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - startTime) / Math.max(16, duration)));
        const ease = 1 - Math.pow(1 - t, 3);
        setViewport({
          x: start.x + (target.x - start.x) * ease,
          y: start.y + (target.y - start.y) * ease,
          zoom: start.zoom + (target.zoom - start.zoom) * ease,
        });
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          animFrameRef.current = null;
        }
      };
      animFrameRef.current = requestAnimationFrame(tick);
    },
    [setViewport]
  );

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const centerOnPoint = useCallback(
    (worldX: number, worldY: number, targetZoom = 1.25) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const wx = clampFinite(worldX, 0);
      const wy = clampFinite(worldY, 0);
      const z = clampFinite(targetZoom, 1.25, MIN_ZOOM, MAX_ZOOM);
      animateViewportTo(
        {
          x: rect.width / 2 - wx * z,
          y: rect.height / 2 - wy * z,
          zoom: z,
        },
        420
      );
    },
    [animateViewportTo]
  );

  const getViewportCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const vp = viewportRef.current;
    const cx = (rect?.width && rect.width > 0 ? rect.width : 900) / 2;
    const cy = (rect?.height && rect.height > 0 ? rect.height : 650) / 2;
    const z = clampFinite(vp.zoom, 1, MIN_ZOOM, MAX_ZOOM);
    return {
      x: clampFinite((cx - vp.x) / z, 0),
      y: clampFinite((cy - vp.y) / z, 0),
    };
  }, []);

  // Wheel zoom centered on mouse cursor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Panels drawn over the canvas (e.g. the category menu) scroll normally
      if (e.target instanceof Element && e.target.closest('[data-canvas-scrollable]')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      setViewport((prev) => {
        const factor = Math.exp(-clampFinite(e.deltaY, 0, -500, 500) * 0.0014);
        const nextZoom = clampFinite(prev.zoom * factor, prev.zoom, MIN_ZOOM, MAX_ZOOM);
        const scale = nextZoom / prev.zoom;
        return {
          zoom: nextZoom,
          x: mx - (mx - prev.x) * scale,
          y: my - (my - prev.y) * scale,
        };
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  return {
    viewport,
    viewportRef,
    setViewport,
    screenToWorld,
    animateViewportTo,
    centerOnPoint,
    getViewportCenter,
  };
}
