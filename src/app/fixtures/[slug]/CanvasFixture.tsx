"use client";

import { useEffect, useRef } from "react";

export function CanvasFixture() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const paint = () => {
      const { width, height } = canvas;
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#dbeafe");
      gradient.addColorStop(1, "#fde68a");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    };

    paint();

    const pointerHandler = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      const current = Number(canvas.dataset.drawCount ?? "0");
      canvas.dataset.drawCount = String(current + 1);
      canvas.dataset.lastDraw = `${Math.round(x)},${Math.round(y)}`;
    };

    canvas.addEventListener("pointerdown", pointerHandler);
    return () => canvas.removeEventListener("pointerdown", pointerHandler);
  }, []);

  return (
    <main className="min-h-screen bg-white p-6 text-black">
      <h1 className="text-2xl font-semibold">Fixture: full-height canvas document</h1>
      <p className="mt-2 text-sm text-zinc-700">
        This fixture mimics a destination with meaningful viewport usage and a visible drawing interaction.
      </p>
      <canvas
        ref={canvasRef}
        id="fixture-canvas"
        data-testid="fixture-canvas"
        width={1400}
        height={900}
        className="mt-4 h-[70vh] w-full border border-zinc-400"
      />
    </main>
  );
}
