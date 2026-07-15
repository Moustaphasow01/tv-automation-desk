import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout";
import { OverlayProvider } from "@/context/OverlayContext";
import LiveDeskPage from "@/pages/LiveDeskPage";
import SessionsPage from "@/pages/SessionsPage";
import MasterPage from "@/pages/MasterPage";
import MonitorsPage from "@/pages/MonitorsPage";
import ThesisPage from "@/pages/ThesisPage";
import SetupPage from "@/pages/SetupPage";
import TimelinePage from "@/pages/TimelinePage";
import NewsPage from "@/pages/NewsPage";
import AuditPage from "@/pages/AuditPage";
import AlertsPage from "@/pages/AlertsPage";
import MorePage from "@/pages/MorePage";
import PerformanceCalendarPage from "@/pages/PerformanceCalendarPage";

export default function App() {
  return <OverlayProvider><Routes>
    <Route element={<AppShell/>}>
      <Route index element={<Navigate to="/live" replace/>}/>
      <Route path="/live" element={<LiveDeskPage/>}/>
      <Route path="/sessions" element={<SessionsPage/>}/>
      <Route path="/master" element={<MasterPage/>}/>
      <Route path="/monitors" element={<MonitorsPage/>}/>
      <Route path="/thesis" element={<ThesisPage/>}/>
      <Route path="/setup" element={<SetupPage/>}/>
      <Route path="/timeline" element={<TimelinePage/>}/>
      <Route path="/news" element={<NewsPage/>}/>
      <Route path="/audit" element={<AuditPage/>}/>
      <Route path="/alerts" element={<AlertsPage/>}/>
      <Route path="/performance" element={<PerformanceCalendarPage/>}/>
      <Route path="/more" element={<MorePage/>}/>
      <Route path="*" element={<Navigate to="/live" replace/>}/>
    </Route>
  </Routes></OverlayProvider>;
}
