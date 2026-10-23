import { Modal } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import './pods.css';

export function DescribeDialog({ title, text, onClose }: { title: string; text: string | undefined; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} large>
      <pre className="pods-describe">{text ?? tKey('dash.pods.describe.loading')}</pre>
    </Modal>
  );
}
