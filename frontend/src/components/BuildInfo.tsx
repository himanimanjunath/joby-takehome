// Renders a small badge showing the deployed branch + short commit SHA.
// Values are inlined at build time via Vite's VITE_* env vars (passed as
// Docker build args by bin/build-frontend.sh). When either value is missing
// — which is the case for prod builds and local `npm run dev` runs — the
// badge is hidden.

export default function BuildInfo() {
  const branch = import.meta.env.VITE_BUILD_BRANCH;
  const commit = import.meta.env.VITE_BUILD_COMMIT;

  if (!branch || !commit) return null;

  const shortCommit = commit.slice(0, 7);

  return (
    <span
      className="build-info"
      title={`Branch: ${branch}\nCommit: ${commit}`}
    >
      {branch}@{shortCommit}
    </span>
  );
}
