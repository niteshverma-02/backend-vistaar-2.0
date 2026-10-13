import { stagesError } from './crop-calendar.domain';

const stage = (name: string) => ({
  stage: name,
  month: 'Nov',
  advice: 'Seed treatment',
  products: [],
});

describe('stagesError', () => {
  it('needs at least one stage', () => {
    expect(stagesError([])).toMatch(/at least one/);
  });

  it('refuses the same stage twice, whatever the case', () => {
    expect(stagesError([stage('Sowing'), stage('sowing')])).toMatch(
      /only once/,
    );
  });

  it('accepts distinct stages', () => {
    expect(stagesError([stage('Sowing'), stage('Tillering')])).toBeNull();
  });
});
