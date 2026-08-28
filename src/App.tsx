import { useState, useEffect } from 'react';

// Supabase mock local até configurarmos a tabela final
const supabaseMock = {
  from: (_table: string) => ({
    select: (_query: string) => Promise.resolve({ data: null, error: null }),
  }),
};

interface ItemRanking {
  name: string;
  fullName?: string;
  total?: number;
  bipsHora?: number;
}

interface HoraAtiva {
  hora: string;
  top10: ItemRanking[];
}

interface ShiftData {
  totalBipsGeral: number;
  horas?: HoraAtiva[];
  rankingTotal?: ItemRanking[];
  rankingTermoTotal?: ItemRanking[];
  rankingLonaTotal?: ItemRanking[];
}

interface EsteiraData {
  shiftRanking: Record<string, ShiftData | null>;
}

type FullData = Record<string, EsteiraData>;

// Gerador fixo de lista de 40 OPS
const OPS_TOP_40 = Array.from({ length: 40 }, (_, i) => `OPS_${String(i + 1).padStart(4, '0')}`);

const NOMES_TOP_10 = [
  'Carlos Eduardo Silva', 'Mariana Oliveira Santos', 'Lucas Gabriel Rodrigues',
  'Fernanda Lima Costa', 'Rafael Henrique Souza', 'Beatriz Almeida Pereira',
  'Thiago Martins Ferreira', 'Juliana Barbosa Lima', 'Roberto Alves Gomes', 'Aline Rocha Ribeiro'
];

const HORAS_T2 = [
  '14:00 - 15:00', '15:00 - 16:00', '16:00 - 17:00', '17:00 - 18:00',
  '18:00 - 19:00', '19:00 - 20:00', '20:00 - 21:00', '21:00 - 22:00'
];

const generateHorasData = (isOps = true, baseBips = 300) => {
  const list = isOps ? OPS_TOP_40.slice(0, 10) : NOMES_TOP_10;
  return HORAS_T2.map((h, index) => ({
    hora: h,
    top10: list.map((item, idx) => ({
      name: item,
      bipsHora: Math.max(50, baseBips + index * 10 - idx * 15),
    })),
  }));
};

const MOCK_DATA: FullData = {
  geral: { shiftRanking: { T1: null, T2: null, T3: null } },
  termo: {
    shiftRanking: {
      T1: { totalBipsGeral: 14800, rankingTotal: OPS_TOP_40.map((ops, idx) => ({ name: ops, total: 1950 - idx * 40 })) },
      T2: { totalBipsGeral: 16500, rankingTotal: OPS_TOP_40.map((ops, idx) => ({ name: ops, total: 2100 - idx * 45 })), horas: generateHorasData(true, 290) },
      T3: { totalBipsGeral: 0 }
    }
  },
  lona: {
    shiftRanking: {
      T1: { totalBipsGeral: 13650, rankingTotal: OPS_TOP_40.map((ops, idx) => ({ name: ops, total: 1900 - idx * 35 })) },
      T2: { totalBipsGeral: 14700, rankingTotal: OPS_TOP_40.map((ops, idx) => ({ name: ops, total: 1980 - idx * 40 })), horas: generateHorasData(true, 260) },
      T3: { totalBipsGeral: 0 }
    }
  },
  termo_nomes: {
    shiftRanking: {
      T1: { totalBipsGeral: 14800, rankingTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 1950 - idx * 100 })) },
      T2: { totalBipsGeral: 16500, rankingTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 2100 - idx * 95 })), horas: generateHorasData(false, 290) },
      T3: { totalBipsGeral: 0 }
    }
  },
  lona_nomes: {
    shiftRanking: {
      T1: { totalBipsGeral: 13650, rankingTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 1900 - idx * 90 })) },
      T2: { totalBipsGeral: 14700, rankingTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 1980 - idx * 85 })), horas: generateHorasData(false, 260) },
      T3: { totalBipsGeral: 0 }
    }
  },
  gestores: {
    shiftRanking: {
      T1: { totalBipsGeral: 28450, rankingTermoTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 1950 - idx * 100 })), rankingLonaTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 1900 - idx * 90 })) },
      T2: { totalBipsGeral: 31200, rankingTermoTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 2100 - idx * 95 })), rankingLonaTotal: NOMES_TOP_10.map((nome, idx) => ({ name: nome, total: 1980 - idx * 85 })) },
      T3: { totalBipsGeral: 0 }
    }
  },
  inbound_bips: {
    shiftRanking: {
      T1: { totalBipsGeral: 21400 },
      T2: { totalBipsGeral: 24800, horas: generateHorasData(false, 330) },
      T3: { totalBipsGeral: 0 }
    }
  }
};

export default function App() {
  const [fullData] = useState<FullData | null>(MOCK_DATA);
  const [currentEsteira, setCurrentEsteira] = useState<string>('geral');
  const [shiftSelect, setShiftSelect] = useState<string>('T2');
  const [turnoGestores, setTurnoGestores] = useState<string>('ALL');
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [targetAbaAposSenha, setTargetAbaAposSenha] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabaseMock.from('bips').select('*');
      if (error) throw error;
      if (data) {
        console.log('Dados do Supabase:', data);
      }
    } catch (err) {
      console.error('Erro ao buscar dados:', err);
    } finally {
      setIsRefreshing(false);
    }
  };
  
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [startDate, endDate, shiftSelect]);

  const handleSetEsteira = (type: string) => {
    if (['gestores', 'termo_nomes', 'lona_nomes', 'inbound_produtividade'].includes(type)) {
      setTargetAbaAposSenha(type);
      setPasswordInput('');
      setIsModalOpen(true);
    } else {
      setCurrentEsteira(type);
    }
  };

  const confirmarSenha = () => {
    if (passwordInput === '1010') {
      if (targetAbaAposSenha) setCurrentEsteira(targetAbaAposSenha);
      setIsModalOpen(false);
      setTargetAbaAposSenha(null);
    } else {
      alert('Senha incorreta! Acesso negado.');
      setPasswordInput('');
    }
  };

  const renderRankPosition = (idx: number) => {
    if (idx === 0) return <span className="rank medal-gold">🥇 1º</span>;
    if (idx === 1) return <span className="rank medal-silver">🥈 2º</span>;
    if (idx === 2) return <span className="rank medal-bronze">🥉 3º</span>;
    return <span className="rank">{idx + 1}º</span>;
  };

  const getGestoresConsolidatedData = () => {
    const termoNomesData = fullData?.termo_nomes?.shiftRanking;
    const lonaNomesData = fullData?.lona_nomes?.shiftRanking;

    const mapTermo = new Map<string, number>();
    const mapLona = new Map<string, number>();
    let totalBipsPer = 0;

    const turnos = turnoGestores === 'ALL' ? ['T1', 'T2', 'T3'] : [turnoGestores];

    turnos.forEach((t) => {
      const termoShift = termoNomesData?.[t];
      const lonaShift = lonaNomesData?.[t];

      if (termoShift) {
        totalBipsPer += termoShift.totalBipsGeral || 0;
        (termoShift.rankingTotal || []).forEach(item => {
          mapTermo.set(item.name, (mapTermo.get(item.name) || 0) + (item.total || 0));
        });
      }

      if (lonaShift) {
        totalBipsPer += lonaShift.totalBipsGeral || 0;
        (lonaShift.rankingTotal || []).forEach(item => {
          mapLona.set(item.name, (mapLona.get(item.name) || 0) + (item.total || 0));
        });
      }
    });

    const rankingTermoTotal: ItemRanking[] = Array.from(mapTermo.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 10);

    const rankingLonaTotal: ItemRanking[] = Array.from(mapLona.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 10);

    return {
      totalBipsGeral: totalBipsPer,
      rankingTermoTotal,
      rankingLonaTotal
    };
  };

  const getCombinedRankingGeral = (): ItemRanking[] => {
    const termoList = fullData?.termo?.shiftRanking?.[shiftSelect]?.rankingTotal || [];
    const lonaList = fullData?.lona?.shiftRanking?.[shiftSelect]?.rankingTotal || [];

    const mapBips = new Map<string, number>();

    termoList.forEach(item => {
      mapBips.set(item.name, (mapBips.get(item.name) || 0) + (item.total || 0));
    });

    lonaList.forEach(item => {
      mapBips.set(item.name, (mapBips.get(item.name) || 0) + (item.total || 0));
    });

    const combined: ItemRanking[] = Array.from(mapBips.entries()).map(([name, total]) => ({
      name,
      total,
    }));

    return combined.sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 40);
  };

  const renderTable = (list?: ItemRanking[], isHora = false, limit: number | null = null) => {
    if (!list || list.length === 0) {
      return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '8px 0' }}>Sem registros.</p>;
    }

    const displayList = limit ? list.slice(0, limit) : list;
    const isPublicTab = ['geral', 'termo', 'lona'].includes(currentEsteira);
    const colHeader = isPublicTab ? 'Nº DO OPS' : 'COLABORADOR';

    return (
      <table>
        <thead>
          <tr>
            <th style={{ width: '60px' }}>#</th>
            <th>{colHeader}</th>
            <th style={{ textAlign: 'right' }}>{isHora ? 'Bips Hora' : 'TOTAL'}</th>
          </tr>
        </thead>
        <tbody>
          {displayList.map((item, idx) => {
            const val = isHora ? item.bipsHora : item.total;
            return (
              <tr key={idx}>
                <td className="rank-col">{renderRankPosition(idx)}</td>
                <td>{item.name}</td>
                <td className="bips">{(val || 0).toLocaleString('pt-BR')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const dataForEsteira = fullData?.[currentEsteira];
  const shiftData = dataForEsteira?.shiftRanking?.[shiftSelect];
  const gestoresConsolidado = getGestoresConsolidatedData();

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const periodLabel = startDate === endDate 
    ? formatDateLabel(startDate)
    : `DE ${formatDateLabel(startDate)} ATÉ ${formatDateLabel(endDate)}`;

  const turnoGestoresLabel = turnoGestores === 'ALL' ? 'TODOS OS TURNOS' : `TURNO ${turnoGestores}`;
  
  const somaBipsBanner = currentEsteira === 'gestores'
    ? gestoresConsolidado.totalBipsGeral
    : currentEsteira === 'geral'
      ? (fullData?.termo?.shiftRanking?.[shiftSelect]?.totalBipsGeral || 0) + (fullData?.lona?.shiftRanking?.[shiftSelect]?.totalBipsGeral || 0)
      : shiftData?.totalBipsGeral || 0;

  return (
    <div className={`app-container ${darkMode ? 'dark-theme' : ''}`}>
      <style>{`
        * { box-sizing: border-box; }

        html, body, #root {
          margin: 0 !important;
          padding: 0 !important;
          width: 100vw !important;
          max-width: 100vw !important;
          min-height: 100vh;
          overflow-x: hidden;
          background-color: var(--bg-color) !important;
        }

        :root {
          --shopee-red: #EE4D2D;
          --shopee-orange: #FF5722;
          --shopee-yellow: #FFBA00;
          --bg-color: #ffffff;
          --card-bg: #ffffff;
          --text-main: #222222;
          --text-muted: #666666;
          --border: #e2e8f0;
          --border-hover: #cbd5e1;
          --table-hover: #f8fafc;
        }

        .dark-theme {
          --bg-color: #1a1d21;
          --card-bg: #24282e;
          --text-main: #e2e8f0;
          --text-muted: #94a3b8;
          --border: #333942;
          --border-hover: #475569;
          --table-hover: #2d333b;
        }

        .app-container {
          width: 100vw;
          min-height: 100vh;
          background-color: var(--bg-color);
          color: var(--text-main);
          font-family: system-ui, -apple-system, sans-serif;
          padding: 16px;
          transition: background-color 0.3s ease, color 0.3s ease;
        }

        .shopee-header-bar {
          background: linear-gradient(135deg, var(--shopee-red) 0%, #ff7337 100%);
          border-radius: 12px;
          padding: 20px 24px;
          margin-bottom: 16px;
          color: #ffffff;
          box-shadow: 0 4px 15px rgba(238, 77, 45, 0.25);
          width: 100%;
        }

        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 12px;
        }

        .shopee-brand-title {
          font-size: 3.2rem;
          font-weight: 900;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin: 0 auto;
          text-transform: uppercase;
          text-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        .header-top-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .live-clock {
          background: rgba(0, 0, 0, 0.25);
          padding: 6px 12px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.85rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .btn-refresh {
          background: #ffffff;
          color: var(--shopee-red);
          border: none;
          padding: 6px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 800;
          font-size: 0.85rem;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          transition: transform 0.1s ease;
        }

        .btn-refresh:active { transform: scale(0.95); }

        .header-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          background: rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(8px);
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.35);
        }

        .dark-theme .header-nav {
          background: rgba(0, 0, 0, 0.25);
          border-color: rgba(255, 255, 255, 0.15);
        }

        .btn-group {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .btn-group button {
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid transparent;
          color: #222;
          padding: 8px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 700;
          font-size: 0.82rem;
          transition: all 0.2s;
        }

        .dark-theme .btn-group button {
          background: rgba(36, 40, 46, 0.9);
          color: #eee;
        }

        .btn-group button.active {
          background: #ffffff;
          color: var(--shopee-red);
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        }

        .dark-theme .btn-group button.active {
          background: var(--shopee-red);
          color: #fff;
        }

        .controls-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .date-range-box-small {
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(255, 255, 255, 0.95);
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          color: #222;
          font-size: 0.75rem;
          font-weight: 700;
        }

        .dark-theme .date-range-box-small {
          background: #24282e;
          color: #fff;
          border-color: #333942;
        }

        .input-control-small {
          background: transparent;
          color: inherit;
          border: none;
          font-weight: 600;
          font-size: 0.78rem;
          outline: none;
          padding: 2px 0;
          max-width: 110px;
        }

        .select-control-small {
          background: rgba(255, 255, 255, 0.95);
          color: #222;
          padding: 6px 10px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.78rem;
        }

        .dark-theme .select-control-small {
          background: #24282e;
          color: #fff;
          border-color: #333942;
        }

        .btn-darkmode {
          background: rgba(0, 0, 0, 0.25);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.3);
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: 0.82rem;
        }

        .banner-total {
          background: linear-gradient(135deg, var(--shopee-red) 0%, #ff7337 100%);
          color: #fff;
          padding: 20px 28px;
          border-radius: 12px;
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          width: 100%;
          box-shadow: 0 4px 18px rgba(238, 77, 45, 0.2);
        }

        .banner-total h2 {
          margin: 0 0 10px 0;
          font-size: 1.35rem;
          font-weight: 800;
          letter-spacing: 0.5px;
        }

        .banner-total .val {
          font-size: 2.6rem;
          font-weight: 900;
          letter-spacing: 1px;
          line-height: 1;
          text-shadow: 0 2px 6px rgba(0,0,0,0.2);
          background: rgba(255, 255, 255, 0.15);
          padding: 8px 24px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .grid-flex {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          width: 100%;
          align-items: start;
        }

        .card {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          width: 100%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
          border-color: var(--border-hover);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        .card-hora { border-top: 5px solid var(--shopee-orange); }
        .card-total { border-top: 5px solid var(--shopee-yellow); }

        .card-full {
          grid-column: 1 / -1;
          width: 100%;
        }

        .card-geral-compact {
          max-width: 650px;
          margin: 0 auto;
        }

        .table-scroll-container {
          max-height: 55vh;
          overflow-y: auto;
          margin-top: 8px;
        }

        .card h3 {
          margin-top: 0;
          font-size: 0.95rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 8px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th, td {
          padding: 8px;
          text-align: left;
          font-size: 0.85rem;
        }

        th {
          color: var(--text-muted);
          border-bottom: 2px solid var(--border);
          position: sticky;
          top: 0;
          background: var(--card-bg);
          z-index: 10;
        }

        .rank-col {
          width: 65px;
          white-space: nowrap;
        }

        .rank {
          font-weight: 800;
          display: inline-block;
        }

        .medal-gold { color: #f59e0b; font-size: 0.95rem; }
        .medal-silver { color: #94a3b8; font-size: 0.95rem; }
        .medal-bronze { color: #d97706; font-size: 0.95rem; }

        td.bips { text-align: right; font-weight: 800; color: var(--shopee-red); }
        tr:hover { background: var(--table-hover); }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(0, 0, 0, 0.6);
          display: flex; justify-content: center; align-items: center;
          z-index: 1000;
        }

        .modal-card {
          background: var(--card-bg);
          padding: 24px;
          border-radius: 10px;
          width: 320px;
          text-align: center;
        }

        .modal-card input {
          width: 100%;
          padding: 8px;
          margin-bottom: 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          text-align: center;
          background: var(--bg-color);
          color: var(--text-main);
        }
      `}</style>

      {/* HEADER SHOPEE */}
      <div className="shopee-header-bar">
        <div className="header-top">
          <div className="live-clock">
            📅 {currentTime.toLocaleDateString('pt-BR')} - 🕒 {currentTime.toLocaleTimeString('pt-BR')}
          </div>

          <div className="shopee-brand-title">
            <span>🛍️ SHOPEE ES2</span>
            <span style={{ fontSize: '1.4rem', fontWeight: '600', opacity: 0.9 }}>| PAINEL OPERACIONAL</span>
          </div>

          <div className="header-top-right">
            <button className="btn-refresh" onClick={fetchData}>
              {isRefreshing ? '⏳ Carregando...' : '🔄 ATUALIZAR'}
            </button>

            <button className="btn-darkmode" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
            </button>
          </div>
        </div>

        <div className="header-nav">
          <div className="btn-group">
            <button className={currentEsteira === 'geral' ? 'active' : ''} onClick={() => handleSetEsteira('geral')}>🏆 RANKING GERAL</button>
            <button className={currentEsteira === 'termo' ? 'active' : ''} onClick={() => handleSetEsteira('termo')}>🔥 ESTEIRA TERMO</button>
            <button className={currentEsteira === 'lona' ? 'active' : ''} onClick={() => handleSetEsteira('lona')}>📦 ESTEIRA LONA</button>
            <button className={currentEsteira === 'termo_nomes' ? 'active' : ''} onClick={() => handleSetEsteira('termo_nomes')}>🔒 TERMO (NOMES)</button>
            <button className={currentEsteira === 'lona_nomes' ? 'active' : ''} onClick={() => handleSetEsteira('lona_nomes')}>🔒 LONA (NOMES)</button>
            <button className={currentEsteira === 'gestores' ? 'active' : ''} onClick={() => handleSetEsteira('gestores')}>👔 GESTORES</button>
            <button className={currentEsteira === 'inbound_bips' ? 'active' : ''} onClick={() => handleSetEsteira('inbound_bips')}>🔒 INBOUND BIPS</button>
          </div>

          <div className="controls-right">
            <div className="date-range-box-small">
              <span>De</span>
              <input
                type="date"
                className="input-control-small"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span>Até</span>
              <input
                type="date"
                className="input-control-small"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            {currentEsteira === 'gestores' ? (
              <select
                className="select-control-small"
                value={turnoGestores}
                onChange={(e) => setTurnoGestores(e.target.value)}
              >
                <option value="ALL">Todos os Turnos (Somados)</option>
                <option value="T1">Turno T1 (06:00 as 14:00)</option>
                <option value="T2">Turno T2 (14:00 as 22:00)</option>
                <option value="T3">Turno T3 (22:00 as 06:00)</option>
              </select>
            ) : (
              <select
                className="select-control-small"
                value={shiftSelect}
                onChange={(e) => setShiftSelect(e.target.value)}
              >
                <option value="T1">Turno T1 (06:00 as 14:00)</option>
                <option value="T2">Turno T2 (14:00 as 22:00)</option>
                <option value="T3">Turno T3 (22:00 as 06:00)</option>
              </select>
            )}
          </div>
        </div>
      </div>

      {/* BANNER TOTAL */}
      <div className="banner-total">
        <h2>
          TOTAL DE BIPS ({currentEsteira.replace('_', ' ').toUpperCase()}) - {currentEsteira === 'gestores' ? `PERÍODO (${periodLabel}) - ${turnoGestoresLabel}` : `TURNO ${shiftSelect}`}
        </h2>
        <div className="val">{somaBipsBanner.toLocaleString('pt-BR')} BIPS</div>
      </div>

      {/* CONTEÚDO DA APLICAÇÃO */}
      {shiftData || currentEsteira === 'geral' || currentEsteira === 'gestores' ? (
        <div style={{ width: '100%' }}>
          {currentEsteira === 'gestores' ? (
            <div className="card card-full">
              <h3 style={{ color: '#2563eb' }}>
                👔 GESTORES — TOP 10 CONSOLIDADO TERMO + LONA — PERÍODO: {periodLabel} | {turnoGestoresLabel}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', width: '100%', marginTop: '12px' }}>
                <div>
                  <h4 style={{ color: 'var(--shopee-red)', margin: '0 0 8px 0' }}>🔥 ESTEIRA TERMO ({turnoGestoresLabel})</h4>
                  {renderTable(gestoresConsolidado.rankingTermoTotal, false, 10)}
                </div>
                <div>
                  <h4 style={{ color: '#059669', margin: '0 0 8px 0' }}>📦 ESTEIRA LONA ({turnoGestoresLabel})</h4>
                  {renderTable(gestoresConsolidado.rankingLonaTotal, false, 10)}
                </div>
              </div>
            </div>
          ) : (
            <>
              {currentEsteira === 'inbound_bips' && (
                <div className="grid-flex">
                  {(shiftData?.horas || []).map((h, hIdx) => (
                    <div key={hIdx} className="card card-hora">
                      <h3 style={{ color: 'var(--shopee-red)' }}>⚡ Hora {h.hora} ({shiftSelect})</h3>
                      {renderTable(h.top10, true, 10)}
                    </div>
                  ))}
                </div>
              )}

              {['termo', 'lona', 'termo_nomes', 'lona_nomes'].includes(currentEsteira) && (
                <div className="grid-flex">
                  <div className="card card-total">
                    <h3 style={{ color: 'var(--shopee-yellow)' }}>🏆 TOTAL ACUMULADO TOP 10 ({shiftSelect})</h3>
                    {renderTable(shiftData?.rankingTotal, false, 10)}
                  </div>

                  {(shiftData?.horas || []).map((h, hIdx) => (
                    <div key={hIdx} className="card card-hora">
                      <h3 style={{ color: 'var(--shopee-orange)' }}>⚡ Hora {h.hora}</h3>
                      {renderTable(h.top10, true, 10)}
                    </div>
                  ))}
                </div>
              )}

              {currentEsteira === 'geral' && (
                <div className="card card-total card-geral-compact">
                  <h3 style={{ color: 'var(--shopee-yellow)', textAlign: 'center' }}>
                    🏆 RANKING GERAL (TERMO + LONA) - TOP 40 - TURNO {shiftSelect}
                  </h3>
                  <div className="table-scroll-container">
                    {renderTable(getCombinedRankingGeral(), false, 40)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <p>Nenhum dado encontrado para as opções selecionadas.</p>
      )}

      {/* MODAL DE AUTENTICAÇÃO */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h4>Acesso Restrito</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Digite a senha:</p>
            <input
              type="password"
              placeholder="••••"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmarSenha()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={() => setIsModalOpen(false)}>Cancelar</button>
              <button style={{ background: 'var(--shopee-red)', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 14px' }} onClick={confirmarSenha}>
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
