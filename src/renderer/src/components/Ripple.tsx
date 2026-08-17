import React, { type ComponentPropsWithoutRef, type CSSProperties } from 'react';

export interface RippleProps extends ComponentPropsWithoutRef<'div'> {
  /** Size of the innermost base circle in pixels (default: 210) */
  mainCircleSize?: number;
  /** Opacity of the innermost base circle (default: 0.35) */
  mainCircleOpacity?: number;
  /** Number of concentric ripple circles to render (default: 8) */
  numCircles?: number;
  /** Primary ray / border color (e.g. #22C55E for green, #EF4444 for red, #38BDF8 for blue) */
  rippleColor?: string;
  /** State variant: 'idle' | 'matched' | 'unmatched' */
  variant?: 'idle' | 'matched' | 'unmatched';
  /** Animation duration in seconds (default: 2.2s) */
  duration?: number;
}

/**
 * Animated Concentric Ripple Component with Dynamic Ray Highlighting
 *
 * Variants:
 * - 'idle' (default): Calming blue/cyan scanning ripples
 * - 'matched': Radiant green glowing rays for supported hardware (JOSH / VEER / DEV)
 * - 'unmatched': Pulsing warning red rays for unrecognized USB hardware
 */
export const Ripple = React.memo(function Ripple({
  mainCircleSize = 210,
  mainCircleOpacity = 0.35,
  numCircles = 8,
  rippleColor,
  variant = 'idle',
  duration = 2.2,
  className = '',
  style,
  ...props
}: RippleProps) {
  // Determine color based on variant if not explicitly overridden
  const activeColor =
    rippleColor ||
    (variant === 'matched'
      ? '#22C55E' // Vivid Green for matched device
      : variant === 'unmatched'
      ? '#EF4444' // Vivid Red for unmatched device
      : '#38BDF8'); // Vivid Cyan/Blue for idle scanning

  return (
    <div
      className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${className}`}
      style={{
        maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 80%)',
        ...style,
      }}
      {...props}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 65;
        const opacity = Math.max(0.04, mainCircleOpacity - i * 0.038);
        const animationDelay = `${i * 0.18}s`;
        const borderStyle = 'solid';

        return (
          <div
            key={i}
            className={`absolute rounded-full border animate-ripple transition-colors duration-500`}
            style={
              {
                '--i': i,
                '--duration': `${duration}s`,
                width: `${size}px`,
                height: `${size}px`,
                opacity,
                animationDelay,
                borderStyle,
                borderWidth: i === 0 ? '2px' : '1px',
                borderColor: activeColor,
                backgroundColor: `${activeColor}08`,
                boxShadow:
                  variant === 'matched'
                    ? `0 0 24px ${activeColor}40, inset 0 0 16px ${activeColor}20`
                    : variant === 'unmatched'
                    ? `0 0 24px ${activeColor}55, inset 0 0 16px ${activeColor}30`
                    : `0 0 18px ${activeColor}25, inset 0 0 10px ${activeColor}15`,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%) scale(1)',
                willChange: 'transform, opacity',
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
});

Ripple.displayName = 'Ripple';
