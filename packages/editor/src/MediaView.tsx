import { PanelBanner, t } from '@deckbuilder/ui';
import { useState } from 'react';

/** An audio or video file played from a blob URL. */
export function MediaView({ url, video }: { url: string; video: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="file-preview">
      {failed && <PanelBanner tone="err" icon="alert">{t('preview.mediaError')}</PanelBanner>}
      <div className="file-preview-body file-preview-image">
        {video
          ? <video className="media-video" src={url} controls onError={() => setFailed(true)} />
          : <audio className="media-audio" src={url} controls onError={() => setFailed(true)} />}
      </div>
    </div>
  );
}
