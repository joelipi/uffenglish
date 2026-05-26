import React, { useRef, useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function SuccessVideoCanvas() {
  const canvasRef = useRef(null);
  const visible = useStore(appStore, state => state.successCanvasVisible);

  useEffect(() => {
    // Expose canvas ref globally for video processor (temporary bridge)
    if (canvasRef.current) {
      window.__successVideoCanvas = canvasRef.current;
    }
    return () => {
      window.__successVideoCanvas = null;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      id="displayCanvas"
      style={{
        width: '100%',
        height: 'calc(100% - 140px)',
        objectFit: 'contain',
        backgroundColor: 'black'
      }}
    />
  );
}
