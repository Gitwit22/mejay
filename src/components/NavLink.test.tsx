import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NavLink } from './NavLink';

describe('NavLink', () => {
  it('should render a link', () => {
    render(
      <MemoryRouter>
        <NavLink to="/test">Test Link</NavLink>
      </MemoryRouter>
    );
    
    expect(screen.getByText('Test Link')).toBeInTheDocument();
  });

  it('should apply base className', () => {
    render(
      <MemoryRouter>
        <NavLink to="/test" className="base-class">
          Test Link
        </NavLink>
      </MemoryRouter>
    );
    
    const link = screen.getByText('Test Link');
    expect(link).toHaveClass('base-class');
  });

  it('should apply activeClassName when link is active', () => {
    render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route
            path="/test"
            element={
              <NavLink to="/test" className="base" activeClassName="active">
                Test Link
              </NavLink>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    
    const link = screen.getByText('Test Link');
    expect(link).toHaveClass('base');
    expect(link).toHaveClass('active');
  });

  it('should not apply activeClassName when link is not active', () => {
    render(
      <MemoryRouter initialEntries={['/other']}>
        <Routes>
          <Route
            path="*"
            element={
              <NavLink to="/test" className="base" activeClassName="active">
                Test Link
              </NavLink>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    
    const link = screen.getByText('Test Link');
    expect(link).toHaveClass('base');
    expect(link).not.toHaveClass('active');
  });

  it('should handle pendingClassName', () => {
    render(
      <MemoryRouter>
        <NavLink to="/test" className="base" pendingClassName="pending">
          Test Link
        </NavLink>
      </MemoryRouter>
    );
    
    const link = screen.getByText('Test Link');
    expect(link).toHaveClass('base');
  });

  it('should forward additional props', () => {
    render(
      <MemoryRouter>
        <NavLink to="/test" data-testid="custom-link">
          Test Link
        </NavLink>
      </MemoryRouter>
    );
    
    expect(screen.getByTestId('custom-link')).toBeInTheDocument();
  });
});
