import { formattedBuildTime, releaseLabel } from '../buildInfo';

interface BuildStampProps {
  className?: string;
}

export default function BuildStamp({ className = '' }: BuildStampProps) {
  return (
    <div className={`text-xs text-gray-500 ${className}`.trim()}>
      <span className="font-semibold text-gray-400">Release {releaseLabel}</span>
      <span className="mx-1">•</span>
      <span>{formattedBuildTime}</span>
    </div>
  );
}