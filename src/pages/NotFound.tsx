import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/" className="text-primary underline hover:text-primary/90">
            Home
          </Link>
          <Link to="/app" className="text-primary underline hover:text-primary/90">
            App
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
