import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useParams } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import { TeacherSessionReviewScreen } from "./components/TeacherSessionReview";
import NotFound from "./pages/NotFound";
import { SyntheticDataNotice } from "./components/SyntheticDataNotice";

/** The per-word confirm and override surface. It existed in the codebase with no route, so
 *  the teacher decision the product is built around could not be reached in the running app. */
function TeacherSessionReviewRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <TeacherSessionReviewScreen sessionId={sessionId} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/teacher/sessions/:sessionId/review" component={TeacherSessionReviewRoute} />
      <Route path="/teacher/materials/:id/review" component={Home} />
      <Route path="/teacher/assignments/confirmation" component={Home} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <SyntheticDataNotice />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
