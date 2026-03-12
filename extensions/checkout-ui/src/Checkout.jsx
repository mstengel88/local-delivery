import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default function extension() {
  render(<s-text>LOCAL DELIVERY DEBUG</s-text>, document.body);
}