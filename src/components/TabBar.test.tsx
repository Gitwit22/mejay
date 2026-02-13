import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  const mockOnTabChange = vi.fn();

  it('should render all three tabs', () => {
    render(<TabBar activeTab="library" onTabChange={mockOnTabChange} />);
    
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Party Mode')).toBeInTheDocument();
    expect(screen.getByText('Playlists')).toBeInTheDocument();
  });

  it('should highlight the active tab', () => {
    render(<TabBar activeTab="party" onTabChange={mockOnTabChange} />);
    
    const partyButton = screen.getByText('Party Mode').closest('button');
    expect(partyButton).toHaveClass('text-primary');
  });

  it('should not highlight inactive tabs', () => {
    render(<TabBar activeTab="party" onTabChange={mockOnTabChange} />);
    
    const libraryButton = screen.getByText('Library').closest('button');
    const playlistsButton = screen.getByText('Playlists').closest('button');
    
    expect(libraryButton).toHaveClass('text-muted-foreground');
    expect(playlistsButton).toHaveClass('text-muted-foreground');
  });

  it('should call onTabChange with correct tab id when clicked', () => {
    render(<TabBar activeTab="library" onTabChange={mockOnTabChange} />);
    
    const partyButton = screen.getByText('Party Mode');
    fireEvent.click(partyButton);
    
    expect(mockOnTabChange).toHaveBeenCalledWith('party');
  });

  it('should call onTabChange for each tab', () => {
    const { rerender } = render(<TabBar activeTab="library" onTabChange={mockOnTabChange} />);
    
    fireEvent.click(screen.getByText('Library'));
    expect(mockOnTabChange).toHaveBeenCalledWith('library');
    
    mockOnTabChange.mockClear();
    fireEvent.click(screen.getByText('Party Mode'));
    expect(mockOnTabChange).toHaveBeenCalledWith('party');
    
    mockOnTabChange.mockClear();
    fireEvent.click(screen.getByText('Playlists'));
    expect(mockOnTabChange).toHaveBeenCalledWith('playlists');
  });

  it('should render with icons', () => {
    const { container } = render(<TabBar activeTab="library" onTabChange={mockOnTabChange} />);
    
    // Check that SVG icons are present
    const svgElements = container.querySelectorAll('svg');
    expect(svgElements.length).toBe(3); // One for each tab
  });
});
