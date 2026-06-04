import { panelQuery, isPanelDbConfigured } from "../db";

export type TeamUser = { id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string | null };
export type Role = { id: string; name: string; description: string | null };

export const loadTeamData = async () => {
  if (!isPanelDbConfigured()) return { users: [], roles: [] };
  const [users, roles] = await Promise.all([
    panelQuery<{ id: string; name: string; email: string; role: string; isactive: boolean; lastloginat: string | null; createdat: string | null }>(
      `SELECT u.id,
              COALESCE(u.display_name,
                       NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                       u.email, u.id) AS name,
              u.email,
              COALESCE(u.role, 'staff') AS role,
              COALESCE(u.is_active, TRUE) AS isactive,
              u.last_login_at::text AS lastloginat,
              u.createdat::text AS createdat
         FROM users u
        ORDER BY u.createdat DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; name: string; description: string | null }>(
      `SELECT id, name, description FROM roles ORDER BY name ASC LIMIT 50`,
    ),
  ]);
  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isactive,
      lastLoginAt: u.lastloginat,
      createdAt: u.createdat,
    })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, description: r.description })),
  };
};
