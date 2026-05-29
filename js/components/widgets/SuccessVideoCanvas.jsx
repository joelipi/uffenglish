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
  );
}
