import React, { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function SuccessVideoCanvas({ canvasRef }) {
  const visible = useStore(appStore, state => state.successCanvasVisible);
  // Null when no display-only after-video loop is running (generation in
  // progress, or the blob fallback path). Flag only — playback side effects
  // live in after-video-player.web.js (stories/060-autoplay-share-video).
  const afterVideoActive = useStore(appStore, state => state.afterVideoActive);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setPaused(false);
  }, [afterVideoActive]);

  // The loop outlives the render session: stop it when this surface goes
  // away (success-screen hide, lesson navigation, Continue/Repeat). The
  // dynamic import keeps this shared component free of a static web-only
  // dependency (same pattern as SuccessButtons.jsx).
  useEffect(() => () => {
    import('../../modules/video/after-video-player.js').then((m) => {
      try { m.stopAfterVideoLoop(); } catch (e) { /* ignore */ }
    }).catch(() => {});
  }, []);

  if (!visible) return null;

  const handleToggle = async () => {
    if (!afterVideoActive) return;
    try {
      const m = await import('../../modules/video/after-video-player.js');
      setPaused(await m.toggleAfterVideo());
    } catch (e) {
      console.warn('[SuccessVideoCanvas] toggle failed:', e?.message);
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        id="displayCanvas"
        data-testid="after-video-canvas"
        onClick={handleToggle}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: 'black',
          zIndex: 20
        }}
      />
      {afterVideoActive && paused && (
        <div onClick={handleToggle} style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: '3rem',
          opacity: 0.8,
          cursor: 'pointer',
          pointerEvents: 'auto',
          zIndex: 21
        }}>
          ▶
        </div>
      )}
    </>
  );
}
