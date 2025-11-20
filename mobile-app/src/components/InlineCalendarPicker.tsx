import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface InlineCalendarPickerProps {
  value?: string; // YYYY-MM-DD
  onChange: (next: string) => void;
  month?: number; // 0-based
  year?: number;
  onNavigate?: (year: number, month: number) => void;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export const InlineCalendarPicker: React.FC<InlineCalendarPickerProps> = ({ value, onChange, month, year, onNavigate }) => {
  const today = new Date();
  const y = year ?? today.getFullYear();
  const m = month ?? today.getMonth();
  const selectedParts = value ? value.split('-').map(Number) : [];
  const selectedY = selectedParts[0];
  const selectedM = (selectedParts[1] || 0) - 1;
  const selectedD = selectedParts[2];

  const grid = useMemo(() => {
    const firstDay = new Date(y, m, 1).getDay(); // 0 Sun .. 6 Sat
    const total = daysInMonth(y, m);
    const weeks: number[][] = [];
    let currentWeek: number[] = Array(firstDay).fill(0);
    for (let d = 1; d <= total; d++) {
      currentWeek.push(d);
      if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
    }
    if (currentWeek.length) { while (currentWeek.length < 7) currentWeek.push(0); weeks.push(currentWeek); }
    return weeks;
  }, [y, m]);

  const prevMonth = () => {
    const nm = m - 1;
    if (onNavigate) onNavigate(nm < 0 ? y - 1 : y, nm < 0 ? 11 : nm);
  };
  const nextMonth = () => {
    const nm = m + 1;
    if (onNavigate) onNavigate(nm > 11 ? y + 1 : y, nm > 11 ? 0 : nm);
  };

  const monthLabel = new Date(y, m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Pressable onPress={prevMonth} style={styles.navBtn} accessibilityLabel="Previous month"><Text style={styles.navBtnText}>‹</Text></Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable onPress={nextMonth} style={styles.navBtn} accessibilityLabel="Next month"><Text style={styles.navBtnText}>›</Text></Pressable>
      </View>
      <View style={styles.weekdayRow}>
        {weekdays.map(d => (<Text key={d} style={styles.weekday}>{d}</Text>))}
      </View>
      {grid.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            if (day === 0) return <View key={di} style={styles.dayCell} />;
            const isSelected = selectedY === y && selectedM === m && selectedD === day;
            return (
              <Pressable
                key={di}
                onPress={() => {
                  const yyyy = y;
                  const mm = String(m + 1).padStart(2,'0');
                  const dd = String(day).padStart(2,'0');
                  onChange(`${yyyy}-${mm}-${dd}`);
                }}
                style={[styles.dayCell, isSelected && styles.daySelected]}
                accessibilityLabel={`Select ${y}-${m+1}-${day}`}
              >
                <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{day}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, backgroundColor: '#ffffff' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  navBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  navBtnText: { fontSize: 18, fontWeight: '600', color: '#4f46e5' },
  monthLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  weekdayRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  weekday: { width: 32, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#475569' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  dayCell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  dayText: { fontSize: 13, color: '#334155' },
  daySelected: { backgroundColor: '#4f46e5' },
  dayTextSelected: { color: '#ffffff', fontWeight: '700' }
});

export default InlineCalendarPicker;
