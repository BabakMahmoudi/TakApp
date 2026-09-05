export default function TakSymbol({ className = '' }: { className?: string }) {
  return (
    <img
      src="/TAK.svg"
      alt="TAK"
      className={`inline-block object-contain ${className}`}
      draggable={false}
    />
  );
}
