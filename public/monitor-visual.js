export const MONITOR_DISPLAY_GAIN=.82;
export const MONITOR_BASELINE_RATIO=.82;
export const MONITOR_RANGE_RATIO=.68;

export function displayActivity(rawIntensity,gain=MONITOR_DISPLAY_GAIN){
  const raw=Number(rawIntensity);
  if(!Number.isFinite(raw)||raw<=0)return 0;
  return Math.tanh(raw*gain);
}

export function monitorDisplayY(rawIntensity,height,{gain=MONITOR_DISPLAY_GAIN,baselineRatio=MONITOR_BASELINE_RATIO,rangeRatio=MONITOR_RANGE_RATIO}={}){
  const h=Math.max(0,Number(height)||0);
  return h*(baselineRatio-displayActivity(rawIntensity,gain)*rangeRatio);
}
