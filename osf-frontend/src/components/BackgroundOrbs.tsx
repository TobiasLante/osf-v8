export function BackgroundOrbs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
      <div
        className="absolute w-[600px] h-[600px] rounded-full opacity-[0.07] blur-[120px] animate-orb-1"
        style={{
          background: "radial-gradient(circle, #ff9500, transparent 70%)",
          top: "-10%",
          left: "10%",
        }}
      />
      <div
        className="absolute w-[500px] h-[500px] rounded-full opacity-[0.05] blur-[100px] animate-orb-2"
        style={{
          background: "radial-gradient(circle, #ff5722, transparent 70%)",
          top: "40%",
          right: "5%",
        }}
      />
      <div
        className="absolute w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[80px] animate-orb-3"
        style={{
          background: "radial-gradient(circle, #ff9500, transparent 70%)",
          bottom: "10%",
          left: "30%",
        }}
      />
    </div>
  );
}
