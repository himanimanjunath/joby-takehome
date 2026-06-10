import DataChart from "./components/DataChart";
import BuildInfo from "./components/BuildInfo";
import "./App.css";

export default function App() {
  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          <span className="logo-text">eBOM Explorer</span>
          <BuildInfo />
        </div>
      </header>

      <main className="main">
        <DataChart />
      </main>
    </div>
  );
}
