import { useEffect, useRef, useState } from 'react';
import type { IntentCard } from '@jungle/shared-types';

type BarcodeDetectorInstance = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

export interface CardScanResult {
  card: IntentCard;
  rawValue: string;
}

export function parseIntentCardPayload(rawValue: string): IntentCard | undefined {
  const tokens = rawValue.trim().toUpperCase().split(/[^A-Z_]+/).filter(Boolean);
  if (tokens.includes('CAUTIOUS')) return 'CAUTIOUS';
  if (tokens.includes('EXPLORE')) return 'EXPLORE';
  if (tokens.includes('VERIFY')) return 'VERIFY';
  if (tokens.includes('CLUE') || tokens.includes('FIND_CLUE')) return 'FIND_CLUE';
  return undefined;
}

export function CardScanner({
  onScan,
  disabled = false,
  feedback,
}: {
  onScan: (result: CardScanResult) => void;
  disabled?: boolean;
  feedback?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const onScanRef = useRef(onScan);
  const disabledRef = useRef(disabled);
  const lastScanRef = useRef({ value: '', at: 0 });
  const armedRef = useRef(true);
  const clearSinceRef = useRef<number | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('Mac 摄像头未开启');
  const [manualValue, setManualValue] = useState('');

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  const stop = () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setEnabled(false);
    setMessage('Mac 摄像头未开启');
  };

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const emit = (rawValue: string) => {
    const card = parseIntentCardPayload(rawValue);
    if (!card) {
      setMessage(`已跳过未知二维码：${rawValue}`);
      return;
    }
    setMessage(`识别成功：${card}`);
    onScanRef.current({ card, rawValue });
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setEnabled(true);
      armedRef.current = true;
      clearSinceRef.current = undefined;
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector) {
        setMessage('当前浏览器不支持原生二维码识别，请使用手动输入');
        return;
      }
      const detector = new Detector({ formats: ['qr_code'] });
      setMessage('正在识别卡牌二维码');
      let lastDetectionAt = 0;
      const scanFrame = async (time: number) => {
        if (!disabledRef.current && time - lastDetectionAt > 240 && videoRef.current?.readyState === 4) {
          lastDetectionAt = time;
          try {
            const codes = await detector.detect(videoRef.current);
            const knownCodes = codes.filter((code) => parseIntentCardPayload(code.rawValue));
            const known = knownCodes[0];
            if (knownCodes.length === 0) {
              clearSinceRef.current ??= Date.now();
              if (!armedRef.current && Date.now() - clearSinceRef.current >= 800) {
                armedRef.current = true;
                setMessage('正在识别卡牌二维码');
              }
            } else {
              clearSinceRef.current = undefined;
            }
            if (known && armedRef.current) {
              armedRef.current = false;
              lastScanRef.current = { value: known.rawValue, at: Date.now() };
              emit(known.rawValue);
              setMessage(`识别成功：${parseIntentCardPayload(known.rawValue)}。请移开卡牌后再出下一张`);
            }
          } catch {
            setMessage('二维码识别器暂时不可用，请使用手动输入');
          }
        }
        frameRef.current = requestAnimationFrame(scanFrame);
      };
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch {
      setMessage('无法打开 Mac 摄像头，请检查浏览器权限');
    }
  };

  return (
    <div className="card-scanner">
      <div className="scanner-view">
        <video ref={videoRef} autoPlay playsInline muted />
        {!enabled && <div className="scanner-reticle"><i /><span>QR</span></div>}
      </div>
      <div className="scanner-console">
        <div className="scanner-status" aria-live="polite">
          <span className={`scanner-dot ${enabled ? 'connected' : ''}`} />
          {feedback || message}
        </div>
        <div className="scanner-actions">
          <button className="secondary-button" disabled={disabled} onClick={enabled ? stop : () => void start()}>
            {enabled ? '关闭摄像头' : '开启扫码'}
          </button>
          <div className="manual-code">
            <input
              aria-label="手动卡牌二维码"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="CAUTIOUS / CLUE"
            />
            <button
              className="secondary-button"
              disabled={disabled || !manualValue.trim()}
              onClick={() => emit(manualValue.trim())}
            >
              读取
            </button>
          </div>
        </div>
        <div className="scanner-known-cards">
          <span>CAUTIOUS</span><span>EXPLORE</span><span>VERIFY</span><span>CLUE</span>
        </div>
      </div>
    </div>
  );
}
