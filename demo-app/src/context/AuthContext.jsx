/**
 * FCC Frontend - Auth Context
 * Provides authentication state to the entire app
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import authApi from '../api/auth.api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authApi.getCurrentUser());
  const [loading, setLoading] = useState(false);

  // Listen for forced logout (e.g. 401 from API)
  useEffect(() => {
    const handleLogout = () => setUser(null);
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  const login = useCallback(async (operatorId, pin) => {
    setLoading(true);
    try {
      const { user: userData } = await authApi.login(operatorId, pin);
      setUser(userData);
      return userData;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUser(null);
  }, []);

  const value = {
    user,
    isLoggedIn: !!user,
    isOperator: user?.role === 'operator',
    isLeader: user?.role === 'leader',
    isManager: user?.role === 'manager',
    loading,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
