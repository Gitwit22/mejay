import { useState, useEffect } from 'react'

// Dev Admin Page - Industrial/Terminal Aesthetic
// Only renders in development mode

interface User {
  id: string
  email: string
  created_at?: string
  access_type?: string
  has_full_access?: number
}

interface Toast {
  message: string
  type: 'success' | 'error'
}

export default function DevAdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dev-admin/users')
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      setUsers(data)
    } catch (err) {
      showToast('Failed to fetch users', 'error')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleDelete = async (userId: string, email: string) => {
    try {
      const res = await fetch(`/api/dev-admin/users/${userId}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId))
        showToast(`Deleted ${email}`, 'success')
      } else {
        showToast(json.error || 'Delete failed', 'error')
      }
    } catch (err) {
      showToast('Network error', 'error')
      console.error(err)
    }
    setDeleteConfirm(null)
  }

  const filteredUsers = users.filter(
    (u) =>
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.id?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }

  return (
    <div style={styles.container}>
      {/* Scanline overlay for CRT effect */}
      <div style={styles.scanlines} />

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.terminalIcon}>▸</div>
          <div>
            <h1 style={styles.title}>DEV ADMIN</h1>
            <p style={styles.subtitle}>USER MANAGEMENT CONSOLE</p>
          </div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.statusDot} />
          <span style={styles.statusText}>DEV MODE</span>
        </div>
      </header>

      {/* Warning Banner */}
      <div style={styles.warningBanner}>
        <span style={styles.warningIcon}>⚠</span>
        <span>DESTRUCTIVE OPERATIONS — CHANGES CANNOT BE UNDONE</span>
      </div>

      {/* Search & Stats Bar */}
      <div style={styles.toolbar}>
        <div style={styles.searchContainer}>
          <span style={styles.searchIcon}>⌕</span>
          <input
            type="text"
            placeholder="Search by email or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          {searchTerm && (
            <button style={styles.clearSearch} onClick={() => setSearchTerm('')}>
              ×
            </button>
          )}
        </div>
        <div style={styles.stats}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{users.length}</span>
            <span style={styles.statLabel}>TOTAL</span>
          </div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{filteredUsers.length}</span>
            <span style={styles.statLabel}>SHOWING</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={styles.tableContainer}>
        {loading ? (
          <div style={styles.loadingState}>
            <div style={styles.spinner} />
            <p>LOADING USERS...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyIcon}>∅</p>
            <p>NO USERS FOUND</p>
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>EMAIL</th>
                <th style={{ ...styles.th, width: '280px' }}>USER ID</th>
                <th style={{ ...styles.th, width: '100px' }}>CREATED</th>
                <th style={{ ...styles.th, width: '100px', textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, index) => (
                <tr
                  key={user.id}
                  style={{
                    ...styles.tr,
                    animationDelay: `${index * 20}ms`,
                  }}
                >
                  <td style={styles.td}>
                    <span style={styles.email}>{user.email}</span>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.userId}>{user.id}</code>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.date}>{formatDate(user.created_at)}</span>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {deleteConfirm === user.id ? (
                      <div style={styles.confirmGroup}>
                        <button
                          style={styles.confirmBtn}
                          onClick={() => handleDelete(user.id, user.email)}
                        >
                          CONFIRM
                        </button>
                        <button style={styles.cancelBtn} onClick={() => setDeleteConfirm(null)}>
                          ×
                        </button>
                      </div>
                    ) : (
                      <button style={styles.deleteBtn} onClick={() => setDeleteConfirm(user.id)}>
                        DELETE
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <footer style={styles.footer}>
        <span>MEJAY DEV CONSOLE v0.1</span>
        <span>•</span>
        <span>NODE_ENV: {import.meta.env.MODE}</span>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            ...styles.toast,
            backgroundColor: toast.type === 'error' ? '#ff3b30' : '#30d158',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    color: '#e0e0e0',
    fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
    fontSize: '13px',
    position: 'relative',
    overflow: 'hidden',
  },
  scanlines: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background:
      'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
    pointerEvents: 'none',
    zIndex: 100,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #222',
    background: 'linear-gradient(180deg, #111 0%, #0a0a0a 100%)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  terminalIcon: {
    width: '36px',
    height: '36px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#00ff88',
    fontSize: '18px',
    fontWeight: 'bold',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    letterSpacing: '2px',
    color: '#fff',
  },
  subtitle: {
    margin: 0,
    fontSize: '10px',
    color: '#666',
    letterSpacing: '1px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#00ff88',
    boxShadow: '0 0 8px #00ff88',
    animation: 'pulse 2s ease-in-out infinite',
  },
  statusText: {
    fontSize: '11px',
    color: '#00ff88',
    letterSpacing: '1px',
  },
  warningBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px',
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderBottom: '1px solid rgba(255, 59, 48, 0.3)',
    color: '#ff3b30',
    fontSize: '11px',
    letterSpacing: '1px',
  },
  warningIcon: {
    fontSize: '14px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid #1a1a1a',
  },
  searchContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    color: '#444',
    fontSize: '14px',
  },
  searchInput: {
    width: '320px',
    padding: '10px 36px',
    backgroundColor: '#111',
    border: '1px solid #222',
    borderRadius: '6px',
    color: '#e0e0e0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  clearSearch: {
    position: 'absolute',
    right: '8px',
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px 8px',
  },
  stats: {
    display: 'flex',
    gap: '24px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  statValue: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#fff',
  },
  statLabel: {
    fontSize: '9px',
    color: '#555',
    letterSpacing: '1px',
  },
  tableContainer: {
    padding: '0 24px 24px',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    fontSize: '10px',
    fontWeight: 600,
    color: '#555',
    letterSpacing: '1px',
    borderBottom: '1px solid #222',
    backgroundColor: '#0d0d0d',
  },
  tr: {
    animation: 'fadeIn 0.3s ease forwards',
    opacity: 0,
  },
  td: {
    padding: '14px 16px',
    borderBottom: '1px solid #151515',
    verticalAlign: 'middle',
  },
  email: {
    color: '#fff',
    fontWeight: 500,
  },
  userId: {
    fontSize: '11px',
    color: '#666',
    backgroundColor: '#111',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #1a1a1a',
  },
  date: {
    color: '#555',
    fontSize: '12px',
  },
  deleteBtn: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    border: '1px solid #333',
    borderRadius: '4px',
    color: '#888',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  confirmGroup: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'flex-end',
  },
  confirmBtn: {
    padding: '6px 14px',
    backgroundColor: '#ff3b30',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelBtn: {
    padding: '6px 10px',
    backgroundColor: '#222',
    border: 'none',
    borderRadius: '4px',
    color: '#888',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 0',
    color: '#444',
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid #222',
    borderTopColor: '#00ff88',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: '16px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 0',
    color: '#333',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '8px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    borderTop: '1px solid #151515',
    color: '#333',
    fontSize: '10px',
    letterSpacing: '1px',
  },
  toast: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    padding: '12px 20px',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 500,
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    animation: 'slideIn 0.3s ease',
    zIndex: 200,
  },
}
