import './NavTile.css';

/**
 * A square navigation tile: icon, title and a short description.
 *
 * With `href` it is a link. Without one it is shown dimmed and not clickable, so a planned page
 * can already sit in the grid; it then carries a "Coming soon" badge unless `badge` says otherwise.
 *
 * Props: title, description, icon (an icon component, see shared/icons.jsx), href, badge.
 */
export default function NavTile({ title, description, icon: Icon, href, badge }) {
  const tag = badge || (href ? null : 'Coming soon');
  const body = (
    <>
      {tag && <span className="nav-tile-badge">{tag}</span>}
      {Icon && <Icon className="nav-tile-icon" />}
      <span className="nav-tile-title">{title}</span>
      {description && <span className="nav-tile-desc">{description}</span>}
    </>
  );
  return href
    ? <a className="nav-tile" href={href}>{body}</a>
    : <div className="nav-tile" aria-disabled="true">{body}</div>;
}
