import React from 'react';
import { AlertCircle } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-red-50 border-4 border-red-200 m-4 rounded-xl text-red-900 font-sans">
          <h1 className="text-2xl font-bold mb-4 flex items-center gap-2 text-black"><AlertCircle /> アプリがクラッシュしました</h1>
          <pre className="bg-red-100 p-4 rounded mb-4 text-sm text-black">{this.state.error?.message}</pre>
          <button onClick={() => window.location.reload()} className="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg font-bold shadow-lg">再読み込み</button>
        </div>
      );
    }
    return this.props.children;
  }
}
