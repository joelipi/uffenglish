import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function SuccessVideoCanvas({ canvasRef }) {
  const visible = useStore(appStore, state => state.successCanvasVisible);

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
