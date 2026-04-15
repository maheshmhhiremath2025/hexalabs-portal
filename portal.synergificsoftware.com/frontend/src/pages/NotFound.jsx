import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
      <div className="text-7xl font-bold text-surface-200 mb-2">404</div>
      <h2 className="text-lg font-semibold text-surface-800 mb-1">Page not found</h2>
      <p className="text-sm text-surface-500 mb-6 max-w-sm">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/" className="btn-primary text-sm">
        Back to Home
      </Link>
    </div>
  );
}
