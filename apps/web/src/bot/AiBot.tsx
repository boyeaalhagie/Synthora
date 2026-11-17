import { useEffect, useId, useRef } from "react";
import { AI_BOT_SVG, createAiBot, type AiBot as Engine, type AiBotOptions } from "./engine.js";

/**
 * Renders the bot's SVG once and hands its elements to the engine, which
 * animates them directly every frame (no React re-renders per frame).
 * Prop changes are forwarded with `update`.
 */
export function AiBot({ size = 64, label, className = "", ...options }: AiBotOptions & { size?: number; label: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const mover = useRef<SVGGElement>(null);
  const bodyGroup = useRef<SVGGElement>(null);
  const body = useRef<SVGPathElement>(null);
  const face = useRef<SVGGElement>(null);
  const mouth = useRef<SVGPathElement>(null);
  const ground = useRef<SVGEllipseElement>(null);
  const core = useRef<SVGEllipseElement>(null);
  // Repeated parts are collected with callback refs; React sets them before effects run.
  const eyes = useRef<(SVGPathElement | null)[]>([]);
  const blush = useRef<(SVGEllipseElement | null)[]>([]);
  const hearts = useRef<(SVGPathElement | null)[]>([]);
  const engine = useRef<Engine | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const required = [svg, mover, bodyGroup, body, face, mouth, ground, core].map((r) => r.current);
    if (required.some((el) => el === null)) return;
    engine.current = createAiBot(
      {
        svg: svg.current!,
        mover: mover.current!,
        bodyGroup: bodyGroup.current!,
        body: body.current!,
        face: face.current!,
        eyes: eyes.current,
        mouth: mouth.current!,
        ground: ground.current!,
        core: core.current!,
        blush: blush.current,
        hearts: hearts.current,
      },
      latest.current,
    );
    return () => {
      engine.current?.destroy();
      engine.current = null;
    };
    // The engine owns the SVG for the component's lifetime; option changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.current?.update(options);
  });

  return (
    <svg ref={svg} viewBox={AI_BOT_SVG.viewBox} width={size} height={size} role="img" aria-label={label} className={`shrink-0 overflow-visible ${className}`}>
      <defs>
        {/* The highlight sits top-left; the engine turns the outline, not the fill, so it stays put. */}
        <radialGradient id={`${id}-body`} cx="34%" cy="28%" r="80%">
          <stop offset="0%" stopColor="var(--color-bot-light)" />
          <stop offset="100%" stopColor="var(--color-bot)" />
        </radialGradient>
      </defs>
      <ellipse ref={ground} cx={0} cy={AI_BOT_SVG.groundY} rx={10} ry={2} fill="var(--color-bot-shadow)" opacity={0.9} />
      <ellipse ref={core} cx={0} cy={AI_BOT_SVG.groundY} rx={7} ry={0.85} fill="var(--color-bot-shadow)" opacity={0.9} />
      <g ref={mover}>
        <g ref={bodyGroup}>
          <path ref={body} d={AI_BOT_SVG.body} fill={`url(#${id}-body)`} />
        </g>
        <g ref={face}>
          {AI_BOT_SVG.blush.map((b, i) => (
            <ellipse key={i} ref={(el) => void (blush.current[i] = el)} cx={b.cx} cy={b.cy} rx={2} ry={1.2} fill="var(--color-bot-blush)" opacity={0} />
          ))}
          {AI_BOT_SVG.eyes.map((d, i) => (
            <path key={i} ref={(el) => void (eyes.current[i] = el)} d={d} fill="var(--color-bot-ink)" stroke="var(--color-bot-ink)" strokeWidth={0} strokeLinejoin="round" />
          ))}
          <path ref={mouth} d={AI_BOT_SVG.mouth} fill="var(--color-bot-ink)" stroke="var(--color-bot-ink)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      {Array.from({ length: AI_BOT_SVG.hearts }, (_, i) => (
        <path key={i} ref={(el) => void (hearts.current[i] = el)} d={AI_BOT_SVG.heart} fill="var(--color-bot-blush)" opacity={0} />
      ))}
    </svg>
  );
}
