import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default function extension() {
  render(<App />, document.body);
}

function App() {
  return <s-text>LOCAL DELIVERY DEBUG</s-text>;
}