export function resumeContextPresentation(context, expanded=false, limit=190){
  const text=String(context||'No recent observed project activity.');
  return {text,expandable:text.length>limit,expanded:Boolean(expanded)};
}
