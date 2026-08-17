import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Usb, CheckCircle2, AlertTriangle, Sparkles, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import { usePrinterStore } from '../store/usePrinterStore';
import { Ripple } from './Ripple';

export interface SplashScreenProps {
  /**
   * Number of concentric ripple circles to render (default: 8)
   */
  numCircles?: number;
  /**
   * Base circle size in px (default: 210)
   */
  mainCircleSize?: number;
  /**
   * Optional manual override for USB connection state
   */
  isUsbConnected?: boolean;
  /**
   * Optional manual override for hardware brand (e.g. 'JOSH', 'VEER', 'DEV', or 'UNSUPPORTED')
   */
  hardwareBrand?: string;
  /**
   * Optional callback when user clicks 'Continue to Dashboard' or dismisses the screen
   */
  onProceed?: () => void;
  /**
   * Whether to display the bottom proceed button (default: true)
   */
  showProceedButton?: boolean;
  /**
   * Whether to automatically dismiss the splash screen after connection settles (default: false)
   */
  autoDismissOnConnect?: boolean;
  /**
   * Auto dismiss delay in milliseconds after connection is established (default: 2500ms)
   */
  autoDismissDelay?: number;
}

/**
 * Modern Dark Blue Landing / Splash Screen with MagicUI Concentric Ripples
 *
 * State & Visual Behavior:
 * 1. Idle (No USB): Rich dark blue background with calm cyan/blue ripples scanning outward.
 * 2. Matched Device: Emits vibrant GREEN rays (#22C55E) with an emerald ambient glow for recognized thermal printers.
 * 3. Unmatched Device: Emits blinking RED rays (#EF4444) with a warning glow for unsupported USB hardware.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({
  numCircles = 8,
  mainCircleSize = 210,
  isUsbConnected: propIsConnected,
  hardwareBrand: propBrand,
  onProceed,
  showProceedButton = true,
  autoDismissOnConnect = false,
  autoDismissDelay = 2500,
}) => {
  const { v1State, startV1Pipeline, isScanning } = usePrinterStore();

  React.useEffect(() => {
    let dismissTimer: NodeJS.Timeout | null = null;
    const isConn = propIsConnected !== undefined ? propIsConnected : Boolean(v1State.usbConnected);
    const isUnsupp = isConn && (v1State.step === 'UNSUPPORTED_PRINTER' || v1State.brand === 'UNSUPPORTED');
    if (isConn && !isUnsupp && autoDismissOnConnect && onProceed) {
      dismissTimer = setTimeout(() => {
        onProceed();
      }, autoDismissDelay);
    }
    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [v1State.usbConnected, v1State.step, v1State.brand, propIsConnected, autoDismissOnConnect, autoDismissDelay, onProceed]);

  // Determine actual connection state from Zustand store or prop overrides
  const isConnected = propIsConnected !== undefined ? propIsConnected : Boolean(v1State.usbConnected);
  const brand = propBrand !== undefined ? propBrand : v1State.brand;

  const isUnsupported = isConnected && (v1State.step === 'UNSUPPORTED_PRINTER' || brand === 'UNSUPPORTED');
  const isMatched = isConnected && !isUnsupported && Boolean(brand);

  // Variant for Ripple component: 'idle' | 'matched' | 'unmatched'
  const variant: 'idle' | 'matched' | 'unmatched' = isUnsupported
    ? 'unmatched'
    : isMatched || isConnected
    ? 'matched'
    : 'idle';

  return (
    <div className="relative w-full h-full min-h-[540px] flex flex-col items-center justify-center overflow-hidden select-none bg-gradient-to-b from-[#060B19] via-[#0B132B] to-[#101F42] text-white">
      {/* Background Ambient Radial Glow (color reactive to match state) */}
      <motion.div
        className="absolute inset-0 pointer-events-none transition-all duration-700"
        animate={{
          background: isUnsupported
            ? 'radial-gradient(circle at 50% 48%, rgba(239, 68, 68, 0.22) 0%, rgba(6, 11, 25, 0) 70%)'
            : isMatched || isConnected
            ? 'radial-gradient(circle at 50% 48%, rgba(34, 197, 94, 0.22) 0%, rgba(6, 11, 25, 0) 70%)'
            : 'radial-gradient(circle at 50% 48%, rgba(56, 189, 248, 0.14) 0%, rgba(6, 11, 25, 0) 70%)',
        }}
      />

      {/* Decorative High-Tech Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #ffffff 1.2px, transparent 1.2px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* MagicUI Concentric Ripple Animation Background */}
      <Ripple
        numCircles={numCircles}
        mainCircleSize={mainCircleSize}
        variant={variant}
        duration={variant === 'unmatched' ? 1.4 : 2.2}
      />

      {/* Central Core Interactive Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center px-4">
        {/* Central USB Badge with Reactive Aura */}
        <motion.div
          className={`relative z-20 w-24 h-24 md:w-28 md:h-28 rounded-3xl flex items-center justify-center shadow-2xl transition-all duration-500 border ${
            isUnsupported
              ? 'bg-gradient-to-br from-rose-900 via-rose-700 to-red-600 border-rose-400/50 shadow-rose-500/40'
              : isMatched || isConnected
              ? 'bg-gradient-to-br from-emerald-900 via-emerald-700 to-teal-600 border-emerald-400/50 shadow-emerald-500/40'
              : 'bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 border-sky-400/30 shadow-sky-500/20'
          }`}
          animate={
            isUnsupported
              ? {
                  scale: [1, 1.06, 1],
                  boxShadow: [
                    '0 0 25px rgba(239, 68, 68, 0.4)',
                    '0 0 50px rgba(239, 68, 68, 0.7)',
                    '0 0 25px rgba(239, 68, 68, 0.4)',
                  ],
                }
              : isMatched || isConnected
              ? {
                  scale: [1, 1.05, 1],
                  boxShadow: [
                    '0 0 25px rgba(34, 197, 94, 0.4)',
                    '0 0 50px rgba(34, 197, 94, 0.7)',
                    '0 0 25px rgba(34, 197, 94, 0.4)',
                  ],
                }
              : {
                  scale: [1, 1.02, 1],
                  boxShadow: [
                    '0 0 15px rgba(56, 189, 248, 0.2)',
                    '0 0 30px rgba(56, 189, 248, 0.35)',
                    '0 0 15px rgba(56, 189, 248, 0.2)',
                  ],
                }
          }
          transition={{
            duration: isUnsupported ? 1.2 : 2.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {isUnsupported ? (
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="text-white flex items-center justify-center"
            >
              <Usb className="w-12 h-12 md:w-14 md:h-14 text-white drop-shadow" />
            </motion.div>
          ) : isMatched || isConnected ? (
            <motion.div
              initial={{ scale: 0.8, rotate: -15 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="text-white flex items-center justify-center"
            >
              <Usb className="w-12 h-12 md:w-14 md:h-14 text-white drop-shadow" />
            </motion.div>
          ) : (
            <Usb className="w-12 h-12 md:w-14 md:h-14 text-sky-400 drop-shadow" />
          )}

          {/* Status Corner Indicator Badge */}
          <div className="absolute -bottom-2 -right-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black shadow-lg border-2 border-slate-900 ${
                isUnsupported
                  ? 'bg-rose-500 text-white animate-bounce'
                  : isMatched || isConnected
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-slate-800 text-sky-300'
              }`}
            >
              {isUnsupported ? (
                <AlertTriangle className="w-4 h-4" />
              ) : isMatched || isConnected ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </span>
          </div>
        </motion.div>

        {/* Dynamic Hardware Status & Descriptive State Banner */}
        <div className="mt-8 text-center space-y-2.5 max-w-md">
          <AnimatePresence mode="wait">
            {isUnsupported ? (
              <motion.div
                key="unmatched-banner"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-1.5"
              >
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-400 text-xs font-extrabold tracking-wide uppercase">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Unmatched USB Device</span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-white tracking-wide">
                  Unsupported Printer Model
                </h2>
                <p className="text-xs text-rose-200/90 font-medium leading-relaxed">
                  A USB device was detected, but it does not match official SEZNIK profiles (JOSH, VEER, or DEV).
                </p>
              </motion.div>
            ) : isMatched || isConnected ? (
              <motion.div
                key="matched-banner"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-1.5"
              >
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-xs font-extrabold tracking-wide uppercase">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Matched Hardware Detected</span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-white tracking-wide">
                  {brand ? `${brand} Thermal Printer Connected` : 'Thermal Printer Ready'}
                </h2>
                <p className="text-xs text-emerald-200/90 font-medium leading-relaxed">
                  {v1State.stepMessage || 'USB connection verified. Ready for automated configuration & testing.'}
                </p>
                {autoDismissOnConnect && (
                  <p className="text-[11px] text-emerald-400 font-bold flex items-center justify-center gap-1.5 pt-1 animate-pulse">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Detection Complete! Redirecting to Dashboard...</span>
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="idle-banner"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-1.5"
              >
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/40 text-sky-400 text-xs font-extrabold tracking-wide uppercase">
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-2 h-2 rounded-full bg-sky-400 shrink-0"
                  />
                  <span>Scanning USB Ports</span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-white tracking-wide">
                  Waiting for Printer Connection
                </h2>
                <p className="text-xs text-slate-400 font-medium leading-relaxed">
                  Plug in your USB thermal printer cable (JOSH, VEER, or DEV) to automatically detect hardware.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Buttons */}
          <div className="pt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => startV1Pipeline()}
              disabled={isScanning}
              className="px-4 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-md disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Re-Scan USB'}</span>
            </button>

            {showProceedButton && onProceed && (
              <button
                onClick={onProceed}
                className={`px-5 py-2 rounded-xl font-extrabold text-xs shadow-lg transition-all flex items-center gap-1.5 ${
                  isUnsupported
                    ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30'
                    : isMatched || isConnected
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/30'
                }`}
              >
                <span>Go to Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Architectural Signature */}
      <div className="absolute bottom-4 z-10 flex items-center gap-2 text-[11px] text-slate-500 font-semibold">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
        <span>SEZNIK Real-Time Hardware Detection Engine</span>
      </div>
    </div>
  );
};
