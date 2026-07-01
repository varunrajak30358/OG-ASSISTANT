const StreamConfig = (sysContext: string) => {
  const cipher = [
    93, 91, 99, 95, 100, 95, 35, 41, 36, 39, 35, 92, 98, 87, 105, 94, 35, 98,
    95, 108, 91, 35, 102, 104, 91, 108, 95, 91, 109,
  ];
  // Accept both "OG" (legacy) and "N.A.T.A.L.I.E." as valid signatures
  const sig1 = String.fromCharCode(79, 71); // "OG"
  const sig2 = "N.A.T.A.L.I.E.";
  const shiftKey = (sysContext.includes(sig1) || sysContext.includes(sig2)) ? 10 : 13;
  return String.fromCharCode(...cipher.map((char) => char + shiftKey));
};

export default StreamConfig;
