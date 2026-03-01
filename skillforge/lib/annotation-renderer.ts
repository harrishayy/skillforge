import type { Annotation } from "@/types";

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  canvasWidth: number,
  canvasHeight: number,
  time: number // performance.now() for animations
) {
  for (const ann of annotations) {
    ctx.save();
    switch (ann.type) {
      case "bounding_box":
        drawBoundingBox(ctx, ann, canvasWidth, canvasHeight, time);
        break;
      case "highlight":
        drawHighlight(ctx, ann, canvasWidth, canvasHeight, time);
        break;
      case "arrow":
        drawArrow(ctx, ann, canvasWidth, canvasHeight, time);
        break;
      case "text_label":
        drawTextLabel(ctx, ann, canvasWidth, canvasHeight);
        break;
    }
    ctx.restore();
  }
}

function drawBoundingBox(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  w: number,
  h: number,
  time: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 0.003);
  const x = ((ann.x ?? 0) / 100) * w;
  const y = ((ann.y ?? 0) / 100) * h;
  const bw = ((ann.width ?? 10) / 100) * w;
  const bh = ((ann.height ?? 10) / 100) * h;

  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 2 + pulse * 2;
  ctx.globalAlpha = 0.6 + pulse * 0.4;

  if (ann.style === "dashed") {
    ctx.setLineDash([8, 4]);
  } else if (ann.style === "pulse") {
    ctx.lineWidth = 1 + pulse * 4;
  }

  ctx.strokeRect(x, y, bw, bh);

  // Label
  if (ann.label) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = ann.color;
    ctx.font = `bold ${Math.max(12, w * 0.013)}px system-ui, sans-serif`;
    ctx.fillText(ann.label, x + 4, y - 6);
  }
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  w: number,
  h: number,
  time: number
) {
  const pulse = 0.15 + 0.1 * Math.sin(time * 0.002);
  const x = ((ann.x ?? 0) / 100) * w;
  const y = ((ann.y ?? 0) / 100) * h;
  const bw = ((ann.width ?? 10) / 100) * w;
  const bh = ((ann.height ?? 10) / 100) * h;

  ctx.fillStyle = ann.color;
  ctx.globalAlpha = pulse;
  ctx.fillRect(x, y, bw, bh);

  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, bw, bh);
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  w: number,
  h: number,
  time: number
) {
  const fromX = ((ann.from_x ?? 50) / 100) * w;
  const fromY = ((ann.from_y ?? 50) / 100) * h;
  const toX = ((ann.to_x ?? 50) / 100) * w;
  const toY = ((ann.to_y ?? 50) / 100) * h;

  ctx.strokeStyle = ann.color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.9;

  if (ann.style !== "solid") {
    ctx.setLineDash([8, 4]);
    ctx.lineDashOffset = -((time / 30) % 12);
  }

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Arrowhead
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLen = Math.max(14, w * 0.015);

  ctx.fillStyle = ann.color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle - Math.PI / 6),
    toY - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLen * Math.cos(angle + Math.PI / 6),
    toY - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  // Label near midpoint
  if (ann.label) {
    const mx = (fromX + toX) / 2;
    const my = (fromY + toY) / 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = ann.color;
    ctx.font = `bold ${Math.max(11, w * 0.012)}px system-ui, sans-serif`;
    ctx.fillText(ann.label, mx + 4, my - 4);
  }
}

function drawTextLabel(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  w: number,
  h: number
) {
  if (!ann.label) return;
  const x = ((ann.x ?? 10) / 100) * w;
  const y = ((ann.y ?? 10) / 100) * h;
  const fontSize = Math.max(13, w * 0.014);

  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(ann.label);
  const padding = 6;
  const boxW = metrics.width + padding * 2;
  const boxH = fontSize + padding * 2;

  // Background pill
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ann.color;
  ctx.beginPath();
  ctx.roundRect(x - padding, y - fontSize - padding, boxW, boxH, 4);
  ctx.fill();

  // Text
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(ann.label, x, y);
}

const ROLE_STYLES: Record<string, { color: string; lineWidth: number; dashPattern: number[]; fillAlpha: number }> = {
  primary: { color: "#10B981", lineWidth: 3, dashPattern: [], fillAlpha: 0.08 },
  context: { color: "#3B82F6", lineWidth: 2, dashPattern: [6, 4], fillAlpha: 0.05 },
  warning: { color: "#EF4444", lineWidth: 3, dashPattern: [], fillAlpha: 0.10 },
};

export function renderClickTargets(
  ctx: CanvasRenderingContext2D,
  clickTargets: Array<{
    bbox_x: number; bbox_y: number; bbox_width: number; bbox_height: number;
    is_primary: boolean; element_text?: string; role?: string;
  }>,
  canvasWidth: number,
  canvasHeight: number,
  time: number
) {
  for (const ct of clickTargets) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
    const x = (ct.bbox_x / 100) * canvasWidth;
    const y = (ct.bbox_y / 100) * canvasHeight;
    const bw = (ct.bbox_width / 100) * canvasWidth;
    const bh = (ct.bbox_height / 100) * canvasHeight;

    const role = ct.role ?? (ct.is_primary ? "primary" : "context");
    const style = ROLE_STYLES[role] ?? ROLE_STYLES.context;

    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth + pulse * (role === "primary" ? 2 : 1.5);
    ctx.globalAlpha = (role === "primary" ? 0.7 : 0.6) + pulse * 0.3;
    ctx.setLineDash(style.dashPattern);
    ctx.strokeRect(x, y, bw, bh);

    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.fillAlpha + pulse * 0.06;
    ctx.fillRect(x, y, bw, bh);

    if (ct.element_text) {
      const fontSize = Math.max(11, canvasWidth * 0.012);
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.globalAlpha = 0.9;
      const textW = ctx.measureText(ct.element_text).width;
      const pad = 4;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x, y - fontSize - pad * 2, textW + pad * 2, fontSize + pad * 2);
      ctx.fillStyle = style.color;
      ctx.fillText(ct.element_text, x + pad, y - pad);
    }
    ctx.restore();
  }
}

/** MediaPipe hand landmark connection pairs (indices) for drawing skeleton lines. */
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17],
  [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
];

export function renderHandLandmarks(
  ctx: CanvasRenderingContext2D,
  hands: Array<{ landmarks: Array<{ x: number; y: number }> }>,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
  offsetX = 0,
  offsetY = 0,
) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 0.005);
  const lineColor = "#3B82F6";
  const dotColor = "#3B82F6";

  for (const hand of hands) {
    const landmarks = hand.landmarks;
    if (landmarks.length < 21) continue;

    const toX = (lm: { x: number; y: number }) => offsetX + (lm.x / 100) * canvasWidth;
    const toY = (lm: { x: number; y: number }) => offsetY + (lm.y / 100) * canvasHeight;

    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (const [i, j] of HAND_CONNECTIONS) {
      if (i < landmarks.length && j < landmarks.length) {
        ctx.moveTo(toX(landmarks[i]), toY(landmarks[i]));
        ctx.lineTo(toX(landmarks[j]), toY(landmarks[j]));
      }
    }
    ctx.stroke();
    ctx.restore();

    for (const lm of landmarks) {
      const x = toX(lm);
      const y = toY(lm);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 4 + pulse * 2, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.globalAlpha = 0.85 + pulse * 0.15;
      ctx.fill();
      ctx.restore();
    }
  }
}
