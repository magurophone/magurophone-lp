import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import './App.css'
import './custom.css'

// データ構造の定数定義
const RANKING_FIELDS = {
  RANK: 0,
  NAME: 1,
  POINTS: 2
}

const GOAL_FIELDS = {
  THIS_WEEK: 0,
  THIS_MONTH: 1
}

const RIGHTS_FIELDS = {
  NAME: 0,
  SONG_REQUEST_5K: 1,      // 🎵 5k: 強制リクエスト
  GAME_RIGHT_10K: 2,        // 🎮 10k: ゲーム権利
  OPENCHAT_20K: 3,          // 💬 20k: オープンチャット
  ACAPELLA_30K: 4,          // 🎤 30k: アカペラ音源
  SONG_REQUEST_40K: 5,      // ⚡ 40k: 強制リクエスト
  MIX_AUDIO_50K: 6,         // 🏆 50k: ミックス音源
  MEMBERSHIP: 7,            // 👑 メンバーシップ
  SPECIAL: 8                // ✨ Special権利
}

const BENEFIT_FIELDS = {
  TITLE: 0,
  NAME: 1,
  DESCRIPTION: 2,
  ICON: 3,
  LABEL: 4
}

const BENEFIT_ICONS = {
  '5k': '🎵',
  '10k': '🎮',
  '20k': '💬',
  '30k': '🎤',
  '40k': '⚡',
  '50k': '🏆',
  'メンバーシップ': '👑'
}

const ICON_FIELDS = {
  LABEL: 0,      // 獲得者名
  IMAGE_URL: 1   // Google Drive URL
}

// Googleスプレッドシートから公開データを取得（範囲指定対応、再試行機能付き）
const fetchSheetData = async (sheetName, range = null, retries = 3) => {
  const SPREADSHEET_ID = window.MAGUROPHONE_CONFIG?.SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID_HERE'

  // 範囲指定がある場合はtqパラメータで範囲を指定
  let url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`
  if (range) {
    url += `&range=${encodeURIComponent(range)}`
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const text = await response.text()
      const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)

      if (!match || !match[1]) {
        throw new Error('Invalid response format from Google Sheets')
      }

      const json = JSON.parse(match[1])

      if (!json.table || !json.table.rows) {
        throw new Error('Invalid data structure from Google Sheets')
      }

      return json.table.rows.map(row => (row.c ?? []).map(cell => cell?.v || ''))
    } catch (error) {
      console.error(`Error fetching ${sheetName}${range ? ` (${range})` : ''} (attempt ${attempt + 1}/${retries}):`, error)

      if (attempt === retries - 1) {
        throw error // 最後の試行で失敗したらエラーを投げる
      }

      // 次の試行前に少し待つ（exponential backoff）
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
    }
  }

  return []
}

// Google DriveのURLをサムネイル表示可能なURLに変換
const convertDriveUrl = (url) => {
  if (!url || typeof url !== 'string') return ''

  // 既に変換済みの場合はそのまま返す
  if (url.includes('/thumbnail?id=')) return url

  // /file/d/FILE_ID/view 形式を /thumbnail?id=FILE_ID&sz=w400 に変換
  // thumbnailを使うことで大きなファイルでも確実に表示できる
  const match = url.match(/\/file\/d\/([^/]+)/)
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w400`
  }

  return url
}

// 枠内アイコンデータを読み込む（新形式：1シートで全月管理）
// A列:yyyymm, B列:ユーザー名, C列:画像URL
const fetchIconData = async () => {
  const iconData = {}

  try {
    // 枠内アイコンシートから全データを取得
    const data = await fetchSheetData('枠内アイコン')

    if (!data || data.length < 1) {
      return iconData
    }

    // 月別にグループ化
    data.forEach(row => {
      // A列: yyyymm（数値の場合があるため文字列に変換）
      const month = String(row[0] || '')
      const userName = row[1] // B列: ユーザー名
      const imageUrl = row[2] // C列: 画像URL

      // データが揃っている行のみ処理
      if (month && userName && imageUrl) {
        if (!iconData[month]) {
          iconData[month] = []
        }

        iconData[month].push({
          label: userName,
          thumbnailUrl: convertDriveUrl(imageUrl),  // サムネイル表示用
          originalUrl: imageUrl  // クリック時用（元のURL）
        })
      }
    })

    return iconData
  } catch (error) {
    console.error('Failed to load icon data:', error)
    return {}
  }
}

// カウントアップアニメーション（ページ読み込み時のみ実行）
const CountUp = ({ end, duration = 2000 }) => {
  const rawEnd = typeof end === 'number' ? end : parseInt(String(end).replace('k', ''), 10)
  const endNum = Number.isFinite(rawEnd) ? rawEnd : 0

  const [count, setCount] = useState(0)
  const hasAnimatedRef = useRef(false)
  const endNumRef = useRef(endNum)
  const durationRef = useRef(duration)

  // refを更新（再レンダリング時に最新の値を保持）
  endNumRef.current = endNum
  durationRef.current = duration

  useEffect(() => {
    // 既にアニメーション実行済みなら最終値を即座に設定
    if (hasAnimatedRef.current) {
      setCount(endNumRef.current)
      return
    }

    hasAnimatedRef.current = true
    const finalValue = endNumRef.current
    const incr = finalValue / (durationRef.current / 16)
    let current = 0

    let animationFrameId
    let startTime = null

    const step = (timestamp) => {
      if (startTime === null) {
        startTime = timestamp
      }

      const elapsed = timestamp - startTime
      const progress = Math.min(elapsed / durationRef.current, 1)
      const nextValue = Math.floor(finalValue * progress)
      setCount(nextValue)

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step)
      } else {
        setCount(finalValue)
      }
    }

    animationFrameId = requestAnimationFrame(step)

    return () => cancelAnimationFrame(animationFrameId)
    // 空の依存配列 = マウント時のみ実行
  }, [])

  return <span>{count}k</span>
}

// 枠内アイコンギャラリーコンポーネント
const IconGallery = ({ icons, selectedMonth, setSelectedMonth, selectedUser, setSelectedUser, loading }) => {
  // 月のリストを降順（新しい順）でソート
  const availableMonths = useMemo(() => {
    return Object.keys(icons).filter(month => icons[month].length > 0).sort().reverse()
  }, [icons])

  // 選択された月のユーザーリストを取得（重複削除、50音順）
  const users = useMemo(() => {
    if (!selectedMonth || !icons[selectedMonth]) return []
    const uniqueUsers = [...new Set(icons[selectedMonth].map(item => item.label))]
    return uniqueUsers.sort((a, b) => a.localeCompare(b, 'ja'))
  }, [selectedMonth, icons])

  // 選択されたユーザーのアイコン一覧を取得
  const userIcons = useMemo(() => {
    if (!selectedMonth || !icons[selectedMonth] || !selectedUser) return []
    return icons[selectedMonth].filter(item => item.label === selectedUser)
  }, [selectedMonth, selectedUser, icons])

  // 月を選択したときにユーザー選択をリセット
  const handleMonthChange = (month) => {
    setSelectedMonth(month)
    setSelectedUser(null)
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4 animate-pulse">🖼️</div>
        <div className="text-xl text-light-blue animate-shimmer">アイコンデータを読み込み中...</div>
      </div>
    )
  }

  if (availableMonths.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">📭</div>
        <div className="text-xl text-gray-400">アイコンデータがありません</div>
      </div>
    )
  }

  // 月タブの表示フォーマット（202602 → 2026年2月）
  const formatMonth = (month) => {
    const year = month.substring(0, 4)
    const m = parseInt(month.substring(4, 6), 10)
    return `${year}年${m}月`
  }

  return (
    <div className="space-y-8">
      {/* 月選択タブ */}
      <div className="overflow-x-auto">
        <div className="flex gap-2 pb-2 min-w-max">
          {availableMonths.map((month) => (
            <button
              key={month}
              onClick={() => handleMonthChange(month)}
              className={`px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                selectedMonth === month
                  ? 'bg-light-blue/20 border border-light-blue/50 text-light-blue'
                  : 'glass-effect border border-light-blue/20 text-gray-400 hover:text-light-blue hover:border-light-blue/40'
              }`}
            >
              {formatMonth(month)}
            </button>
          ))}
        </div>
      </div>

      {selectedMonth && (
        <>
          {/* 獲得者一覧 */}
          <section>
            <h3 className="text-xl md:text-2xl font-body mb-4 text-light-blue">獲得者一覧</h3>
            <div className="grid grid-cols-2 xs:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {users.map((user) => (
                <button
                  key={user}
                  onClick={() => setSelectedUser(user === selectedUser ? null : user)}
                  className={`glass-effect rounded-lg p-3 transition-all text-center ${
                    selectedUser === user
                      ? 'border-2 border-amber text-amber'
                      : 'border border-light-blue/30 hover:border-light-blue text-gray-300 hover:text-light-blue'
                  }`}
                >
                  <div className="text-sm font-body truncate">{user}</div>
                </button>
              ))}
            </div>
          </section>

          {/* アイコン画像表示 */}
          {selectedUser && (
            <section>
              <h3 className="text-xl md:text-2xl font-body mb-4 text-amber">
                {selectedUser} のアイコン
              </h3>
              {userIcons.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {userIcons.map((icon, index) => (
                    <a
                      key={index}
                      href={icon.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-effect rounded-lg overflow-hidden border border-light-blue/30 hover:border-amber transition-all group aspect-square"
                    >
                      <img
                        src={icon.thumbnailUrl}
                        alt={`${icon.label}のアイコン`}
                        className="w-full h-full object-contain bg-deep-blue/30 group-hover:scale-105 transition-transform"
                        loading="lazy"
                        onError={(e) => {
                          e.target.onerror = null
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%23222"%3E%3C/rect%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="16"%3E画像エラー%3C/text%3E%3C/svg%3E'
                        }}
                      />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  アイコンがありません
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function App() {
  // Navigation state
  const [currentView, setCurrentView] = useState('home') // 'home' | 'menu' | 'rights' | 'icons'

  // Existing state
  const [ranking, setRanking] = useState([])
  const [goals, setGoals] = useState([])
  const [rights, setRights] = useState([])
  const [benefits, setBenefits] = useState([])
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [selectedBenefit, setSelectedBenefit] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  // Icon gallery state
  const [icons, setIcons] = useState({}) // { '202602': [...], '202603': [...] }
  const [loadingIcons, setLoadingIcons] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(null) // Currently selected month tab
  const [selectedUser, setSelectedUser] = useState(null) // Currently selected user for filtering icons

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // dataシートから範囲指定で4種のデータを取得
      const [rankingData, goalsData, benefitsData, rightsData] = await Promise.all([
        fetchSheetData('data', 'A2:D5'),      // ランキング：A2:D5（2行目ヘッダー）
        fetchSheetData('data', 'A8:B12'),     // 目標：A8:B12（8行目ヘッダー）
        fetchSheetData('data', 'G2:K12'),     // 特典説明：G2:K12（2行目ヘッダー）
        fetchSheetData('data', 'A15:I1000')   // 権利者：A15:I1000（15行目ヘッダー、16行目以降データ）
      ])

      // ランキングはヘッダー含む（2行目がヘッダー）
      setRanking(rankingData)

      // 目標、特典説明はヘッダーをスキップ
      // 権利者はgviz APIが15行目をヘッダーとして自動除外するためslice不要
      setGoals(goalsData.slice(1))
      setBenefits(benefitsData.slice(1))
      setRights(rightsData)

      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      console.error('Failed to load data:', err)
      setError('データの読み込みに失敗しました。しばらくしてから再度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()

    // 5分ごとに自動更新
    const intervalId = setInterval(() => {
      loadData()
    }, 5 * 60 * 1000) // 5分 = 300,000ミリ秒

    return () => clearInterval(intervalId)
  }, [loadData])

  // Escキーでポップアップを閉じる
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (selectedBenefit) {
          setSelectedBenefit(null)
        } else if (selectedPerson) {
          setSelectedPerson(null)
        }
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [selectedPerson, selectedBenefit])

  // ポップアップ表示時のスクロール防止
  useEffect(() => {
    if (selectedPerson || selectedBenefit) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [selectedPerson, selectedBenefit])

  // アイコンデータの読み込み（アイコンビューに切り替えた時）
  useEffect(() => {
    const loadIconData = async () => {
      // 既に読み込み済みまたは読み込み中の場合はスキップ
      if (Object.keys(icons).length > 0 || loadingIcons) return

      setLoadingIcons(true)
      try {
        const iconData = await fetchIconData()
        setIcons(iconData)

        // デフォルトで最新の月を選択
        const months = Object.keys(iconData).sort().reverse()
        if (months.length > 0 && !selectedMonth) {
          setSelectedMonth(months[0])
        }
      } catch (error) {
        console.error('Failed to load icon data:', error)
      } finally {
        setLoadingIcons(false)
      }
    }

    if (currentView === 'icons') {
      loadIconData()
    }
  }, [currentView, icons, loadingIcons, selectedMonth])

  // 権利者を50音順にソート（useMemoで最適化）
  const sortedRights = useMemo(() => {
    return [...rights].sort((a, b) =>
      String(a[RIGHTS_FIELDS.NAME] ?? '').localeCompare(String(b[RIGHTS_FIELDS.NAME] ?? ''), 'ja')
    )
  }, [rights])

  // 権利を持っているかチェック
  const hasRight = (value) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase()
      if (normalized === 'TRUE') {
        return true
      }
      const parsed = Number(normalized)
      return Number.isFinite(parsed) && parsed > 0
    }
    return value > 0
  }

  // 検索フィルター（useMemoで最適化）
  const filteredRights = useMemo(() => {
    return sortedRights.filter(person => {
      const name = String(person[RIGHTS_FIELDS.NAME] ?? '').trim()
      const normalizedSearch = searchTerm.toLowerCase()

      const hasAnyRight = [
        RIGHTS_FIELDS.SONG_REQUEST_5K,
        RIGHTS_FIELDS.GAME_RIGHT_10K,
        RIGHTS_FIELDS.OPENCHAT_20K,
        RIGHTS_FIELDS.ACAPELLA_30K,
        RIGHTS_FIELDS.SONG_REQUEST_40K,
        RIGHTS_FIELDS.MIX_AUDIO_50K,
        RIGHTS_FIELDS.MEMBERSHIP
      ].some(field => hasRight(person[field]))

      const specialValue = String(person[RIGHTS_FIELDS.SPECIAL] ?? '').trim()
      const normalizedSpecial = specialValue.toUpperCase()
      const specialFalseTokens = new Set([
        '',
        'FALSE',
        '0',
        'なし',
        '無し',
        '無',
        '-',
        'ー',
        '－',
        '―',
        '—',
        '–',
        '−',
        '・',
        'N/A',
        'NA'
      ])
      const hasSpecial =
        hasRight(specialValue) ||
        (normalizedSpecial !== '' && !specialFalseTokens.has(normalizedSpecial) && !specialFalseTokens.has(specialValue))

      if (
        !name ||
        !name.toLowerCase().includes(normalizedSearch) ||
        (!hasAnyRight && !hasSpecial)
      ) {
        return false
      }

      return true
    })
  }, [sortedRights, searchTerm, hasRight])

  // 権利のアイコンを取得
  const getRightsIcons = useCallback((person) => {
    const icons = []
    if (hasRight(person[RIGHTS_FIELDS.SONG_REQUEST_5K])) icons.push(BENEFIT_ICONS['5k'])
    if (hasRight(person[RIGHTS_FIELDS.GAME_RIGHT_10K])) icons.push(BENEFIT_ICONS['10k'])
    if (hasRight(person[RIGHTS_FIELDS.OPENCHAT_20K])) icons.push(BENEFIT_ICONS['20k'])
    if (hasRight(person[RIGHTS_FIELDS.ACAPELLA_30K])) icons.push(BENEFIT_ICONS['30k'])
    if (hasRight(person[RIGHTS_FIELDS.SONG_REQUEST_40K])) icons.push(BENEFIT_ICONS['40k'])
    if (hasRight(person[RIGHTS_FIELDS.MIX_AUDIO_50K])) icons.push(BENEFIT_ICONS['50k'])
    if (hasRight(person[RIGHTS_FIELDS.MEMBERSHIP])) icons.push(BENEFIT_ICONS['メンバーシップ'])
    return icons
  }, [])

  const getBenefitByTitle = useCallback((title) => {
    return benefits.find(benefit => benefit[BENEFIT_FIELDS.TITLE] === title)
  }, [benefits])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🐟</div>
          <div className="text-xl text-light-blue animate-shimmer">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-effect rounded-2xl p-8 border border-tuna-red/30 max-w-md w-full text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-2xl font-body mb-4 text-tuna-red">エラー</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <button
            onClick={loadData}
            className="px-6 py-3 bg-amber/20 hover:bg-amber/30 border border-amber/50 rounded-xl transition-all text-amber font-body"
          >
            再読み込み
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* デスクトップ用サイドバーナビゲーション */}
      <aside className="hidden md:fixed md:flex md:flex-col md:left-0 md:top-0 md:bottom-0 md:w-64 glass-effect border-r border-light-blue/30 z-40 p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-display font-black text-transparent bg-clip-text bg-gradient-to-r from-ocean-teal via-light-blue to-amber">
            MAGUROPHONE
          </h1>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => setCurrentView('home')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all flex items-center gap-3 ${
              currentView === 'home'
                ? 'bg-light-blue/20 border border-light-blue/50 text-light-blue'
                : 'hover:bg-light-blue/10 text-gray-300 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">🏠</span>
            <span className="font-body">Home</span>
          </button>

          <button
            onClick={() => setCurrentView('menu')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all flex items-center gap-3 ${
              currentView === 'menu'
                ? 'bg-light-blue/20 border border-light-blue/50 text-light-blue'
                : 'hover:bg-light-blue/10 text-gray-300 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">🍾</span>
            <span className="font-body">Menu</span>
          </button>

          <button
            onClick={() => setCurrentView('rights')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all flex items-center gap-3 ${
              currentView === 'rights'
                ? 'bg-light-blue/20 border border-light-blue/50 text-light-blue'
                : 'hover:bg-light-blue/10 text-gray-300 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">👥</span>
            <span className="font-body">ボトルキープ</span>
          </button>

          <button
            onClick={() => setCurrentView('icons')}
            className={`w-full text-left px-4 py-3 rounded-lg transition-all flex items-center gap-3 ${
              currentView === 'icons'
                ? 'bg-light-blue/20 border border-light-blue/50 text-light-blue'
                : 'hover:bg-light-blue/10 text-gray-300 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">🖼️</span>
            <span className="font-body">枠内アイコン</span>
          </button>
        </nav>

        {lastUpdate && (
          <div className="mt-auto pt-6 border-t border-light-blue/20 text-xs text-gray-500">
            最終更新: {lastUpdate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </aside>

      {/* メインコンテンツエリア（デスクトップではサイドバー分の余白を追加） */}
      <div className="md:ml-64">
      {/* ヘッダー画像エリア（HOMEビューのみ表示） */}
      {currentView === 'home' && (
      <div className="w-full h-[300px] md:h-[600px] relative overflow-hidden bg-gradient-to-b from-deep-blue via-ocean-teal/30 to-deep-blue">
        {/* ヘッダー画像 */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat header-image"
        ></div>
        {/* オーバーレイ（画像を少し暗くして文字を読みやすく） */}
        <div className="absolute inset-0 bg-black/30"></div>
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEuNSIgZmlsbD0icmdiYSgxMzgsIDE4MCwgMjQ4LCAwLjA1KSIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMjAiIHI9IjIiIGZpbGw9InJnYmEoMTM4LCAxODAsIDI0OCwgMC4wOCkiLz48Y2lyY2xlIGN4PSIzNSIgY3k9IjEwIiByPSIxIiBmaWxsPSJyZ2JhKDEzOCwgMTgwLCAyNDgsIDAuMDMpIi8+PC9zdmc+')] opacity-20 animate-float"></div>
        {/* 気泡アニメーション */}
        <div className="bubbles-container">
          <div className="bubble"></div>
          <div className="bubble"></div>
          <div className="bubble"></div>
          <div className="bubble"></div>
          <div className="bubble"></div>
          <div className="bubble"></div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-4xl md:text-8xl font-display font-black text-transparent bg-clip-text bg-gradient-to-r from-ocean-teal via-light-blue to-amber text-glow-soft mb-4">
              BAR MAGUROPHONE
            </h1>
          </div>
        </div>

        {/* 更新ボタン（右上） */}
        <div className="absolute top-4 right-4 flex items-center gap-3">
          {lastUpdate && (
            <div className="hidden md:block text-xs text-gray-400">
              最終更新: {lastUpdate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="glass-effect px-4 py-2 rounded-lg border border-light-blue/30 hover:border-amber transition-all text-sm font-body disabled:opacity-50 disabled:cursor-not-allowed"
            title="データを再読み込み"
          >
            {loading ? '🔄' : '↻'} 更新
          </button>
        </div>
      </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6 md:py-12 pb-24 md:pb-12 space-y-8 md:space-y-16">
        {/* Home View - ランキング + 目標 + FAQ */}
        {currentView === 'home' && (
          <>
        {/* ランキング */}
        <section className="text-center">
          <h2 className="text-2xl md:text-4xl font-body mb-4 md:mb-8 text-glow-soft text-light-blue">Ranking</h2>
          <div className="grid grid-cols-1 xs:grid-cols-3 gap-3 md:gap-6">
            {ranking.slice(0, 3).map((person, index) => (
              <div key={`${person[RANKING_FIELDS.NAME] ?? 'rank'}-${index}`} className={`
                glass-effect rounded-2xl p-4 md:p-8 border transition-all hover:scale-105 water-shimmer
                ${index === 0 ? 'border-tuna-red/50 box-glow-soft' : 'border-light-blue/30'}
              `}>
                <div className="mb-2 md:mb-4 flex justify-center">
                  {index === 0 && <img src="./medal-1st.jpg" alt="1位" className="w-12 h-12 md:w-16 md:h-16 object-cover rounded-full" />}
                  {index === 1 && <img src="./medal-2nd.jpg" alt="2位" className="w-12 h-12 md:w-16 md:h-16 object-cover rounded-full" />}
                  {index === 2 && <img src="./medal-3rd.jpg" alt="3位" className="w-12 h-12 md:w-16 md:h-16 object-cover rounded-full" />}
                </div>
                <div className="text-xs md:text-2xl font-body mb-1 md:mb-2 whitespace-nowrap overflow-hidden h-4 md:h-8">{person[RANKING_FIELDS.NAME]}</div>
                <div className={`text-2xl md:text-4xl font-black ${index === 0 ? 'text-tuna-red' : 'text-amber'}`}>
                  <CountUp end={person[RANKING_FIELDS.POINTS]} />
                </div>
                <div className="text-xs md:text-sm text-gray-400 mt-1 md:mt-2">歌推しPt</div>
              </div>
            ))}
          </div>
        </section>

        {/* 目標 */}
        <section className="text-center">
          <h2 className="text-2xl md:text-4xl font-body mb-4 md:mb-8 text-glow-soft text-amber">Targets</h2>
          <div className="grid grid-cols-2 gap-3 md:gap-6 max-w-4xl mx-auto">
            {/* 今旬の目標 */}
            <div className={`glass-effect rounded-2xl p-4 md:p-6 border border-amber/30 ${goals.length === 0 || !goals[0] || !goals[0][GOAL_FIELDS.THIS_WEEK] ? 'opacity-50' : ''}`}>
              <h3 className="text-lg md:text-2xl font-body mb-2 md:mb-4 text-light-blue">今旬の目標</h3>
              {goals.map((goal, index) => (
                goal[GOAL_FIELDS.THIS_WEEK] && (
                  <div key={index} className="text-sm md:text-lg mb-2 md:mb-4 last:mb-0">
                    <span className="text-amber">▸</span> {goal[GOAL_FIELDS.THIS_WEEK]}
                  </div>
                )
              ))}
            </div>

            {/* 今月の目標 */}
            <div className={`glass-effect rounded-2xl p-4 md:p-6 border border-amber/30 ${goals.length === 0 || !goals[0] || !goals[0][GOAL_FIELDS.THIS_MONTH] ? 'opacity-50' : ''}`}>
              <h3 className="text-lg md:text-2xl font-body mb-2 md:mb-4 text-light-blue">今月の目標</h3>
              {goals.map((goal, index) => (
                goal[GOAL_FIELDS.THIS_MONTH] && (
                  <div key={index} className="text-sm md:text-lg mb-2 md:mb-4 last:mb-0">
                    <span className="text-amber">▸</span> {goal[GOAL_FIELDS.THIS_MONTH]}
                  </div>
                )
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-4xl font-body mb-8 text-center text-glow-soft text-light-blue">📝 FAQ・注意事項</h2>
          <div className="glass-effect rounded-2xl p-8 border border-light-blue/30 space-y-6">
            <div>
              <h3 className="text-xl font-body text-amber mb-2">▸ 特典の使用方法は？</h3>
              <p className="text-gray-300 ml-6">枠内でリクエストするか、XのDMでお知らせください。</p>
            </div>
            <div>
              <h3 className="text-xl font-body text-amber mb-2">▸ 10k以上の特典について</h3>
              <p className="text-gray-300 ml-6">永続権利です。月が替わっても消えることがありません。</p>
            </div>
            <div>
              <h3 className="text-xl font-body text-amber mb-2">▸ メンバーシップ特典について</h3>
              <p className="text-gray-300 ml-6">メンバーシップ特典で得られた10ｋ及び20ｋ特典は、それぞれの箇所に合算して記載しています。</p>
            </div>
          </div>
        </section>
          </>
        )}

        {/* Menu View - 特典制度 */}
        {currentView === 'menu' && (
          <section>
            <h2 className="text-2xl md:text-4xl font-body mb-6 md:mb-12 text-center text-glow-soft text-light-blue">Menu</h2>
          <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-6">
            {benefits.map((benefit, index) => (
              <div 
                key={index} 
                onClick={(e) => {
                  if (window.innerWidth < 768) {
                    setSelectedBenefit(benefit);
                  }
                }}
                className="group glass-effect rounded-2xl md:p-6 border border-light-blue/30 hover:border-amber md:hover:border-light-blue/30 transition-all hover:scale-105 md:hover:scale-100 cursor-pointer md:cursor-default text-center overflow-hidden flex flex-col"
              >
                {/* モバイル版：簡略表示 */}
                <div className="md:hidden py-3 px-4 bg-amber/10 rounded-2xl relative">
                  {/* 左上バッジ */}
                  <div className="absolute top-2 left-2">
                    <span className="text-xs font-bold text-amber font-body">{benefit[BENEFIT_FIELDS.TITLE]}</span>
                  </div>
                  {/* 本文 */}
                  <div className="pt-6">
                    <span className="text-sm text-amber font-body">{benefit[BENEFIT_FIELDS.LABEL]}</span>
                  </div>
                </div>

                {/* ボトルラベル（PC版のみ） */}
                {benefit[BENEFIT_FIELDS.LABEL] && (
                  <div className="hidden md:block py-3 px-4 md:px-6 bg-amber/10 rounded-2xl md:rounded-t-2xl md:mb-4 md:pb-3 md:border-b border-amber/30 md:-mx-6 md:-mt-6">
                    <div className="flex items-center justify-center pt-1">
                      <span className="text-sm md:text-base text-amber font-body">{benefit[BENEFIT_FIELDS.TITLE]} {benefit[BENEFIT_FIELDS.LABEL]}</span>
                    </div>
                  </div>
                )}

                {/* PC版：フル表示 */}
                <div className="hidden md:block flex-1">
                  <div className="flex items-center justify-center mb-2 md:mb-4">
                    <span className="text-3xl md:text-5xl animate-float">{benefit[BENEFIT_FIELDS.ICON]}</span>
                  </div>
                  <p className="text-base md:text-lg font-bold mb-1 md:mb-2 whitespace-pre-line">{benefit[BENEFIT_FIELDS.NAME]}</p>
                  <p className="text-xs md:text-sm text-gray-400">{benefit[BENEFIT_FIELDS.DESCRIPTION]}</p>
                </div>
              </div>
            ))}
          </div>
          </section>
        )}

        {/* Rights View - 権利者リスト */}
        {currentView === 'rights' && (
        <section>
          <h2 className="text-2xl md:text-4xl font-body mb-4 md:mb-8 text-center text-glow-soft text-amber">🍾 ボトルキープ一覧</h2>
          
          <div className="mb-6 max-w-2xl mx-auto">
            <input
              type="text"
              placeholder="🔍 名前で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-6 py-3 glass-effect border border-light-blue/30 rounded-xl focus:outline-none focus:border-amber transition-all text-white placeholder-gray-500"
            />
          </div>

          <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRights.map((person, index) => (
              <div
                key={index}
                onClick={() => setSelectedPerson(person)}
                className="glass-effect rounded-xl p-4 md:p-6 border border-light-blue/30 hover:border-amber transition-all hover:scale-105 cursor-pointer group h-32 md:h-36 text-center flex flex-col"
              >
                <h3 className="text-base md:text-xl font-body group-hover:text-amber transition-colors flex items-center justify-center" style={{ flexGrow: 1, flexShrink: 1, flexBasis: '0%', minHeight: 0 }}>
                  {person[RIGHTS_FIELDS.NAME]}
                </h3>
                <div className="flex items-center justify-center flex-wrap gap-2 text-lg md:text-2xl" style={{ flexGrow: 2, flexShrink: 1, flexBasis: '0%', minHeight: 0, paddingTop: '13px', alignContent: 'flex-start', boxSizing: 'border-box' }}>
                  {getRightsIcons(person).map((icon, i) => (
                    <span key={i} className="animate-float" style={{ animationDelay: `${i * 0.2}s` }}>
                      {icon}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        )}

        {/* Icons View - 枠内アイコンギャラリー */}
        {currentView === 'icons' && (
          <section>
            <h2 className="text-2xl md:text-4xl font-body mb-6 md:mb-12 text-center text-glow-soft text-amber">🖼️ 枠内アイコン</h2>
            <IconGallery
              icons={icons}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
              selectedUser={selectedUser}
              setSelectedUser={setSelectedUser}
              loading={loadingIcons}
            />
          </section>
        )}

        {/* フッター */}
        <footer className="text-center py-8 border-t border-light-blue/30">
          <p className="text-xl font-body mb-4">深海BAR MAGUROPHONE 🐟🎧</p>
          <p className="text-gray-400">単推し・最推し様・メンシプ様募集中です</p>
          <p className="text-sm text-gray-500 mt-4">ファンマ: 🐟🎧</p>
        </footer>
      </div>

      {/* 権利者詳細ポップアップ */}
      {selectedPerson && (
        <div 
          onClick={() => setSelectedPerson(null)}
          className="fixed inset-0 bg-black/70 flex items-start justify-center p-4 z-50 overflow-y-auto"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="glass-effect rounded-2xl p-8 border border-light-blue/30 box-glow-soft max-w-2xl w-full relative my-8 max-h-[90vh] flex flex-col"
          >
            <button
              onClick={() => setSelectedPerson(null)}
              className="absolute top-4 right-4 text-2xl text-gray-400 hover:text-white transition-colors z-10"
            >
              ×
            </button>
            
            <h2 className="text-2xl md:text-4xl font-body mb-4 md:mb-8 text-glow-soft text-amber flex-shrink-0 text-center">
              {selectedPerson[RIGHTS_FIELDS.NAME]}
            </h2>

            <div className="space-y-6 overflow-y-auto pr-2 flex-1">
              {hasRight(selectedPerson[RIGHTS_FIELDS.SONG_REQUEST_5K]) && (
                <div 
                  onClick={() => setSelectedBenefit(getBenefitByTitle('5k'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-light-blue/20 cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('5k')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('5k')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('5k')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['5k']}</span>
                    </div>
                    <p className="text-gray-300">強制リクエスト: {selectedPerson[RIGHTS_FIELDS.SONG_REQUEST_5K]}曲</p>
                  </div>
                </div>
              )}
              
              {hasRight(selectedPerson[RIGHTS_FIELDS.GAME_RIGHT_10K]) && (
                <div
                  onClick={() => setSelectedBenefit(getBenefitByTitle('10k'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-light-blue/20 cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('10k')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('10k')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('10k')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['10k']}</span>
                    </div>
                    <p className="text-gray-300">権利: {selectedPerson[RIGHTS_FIELDS.GAME_RIGHT_10K]}時間分</p>
                  </div>
                </div>
              )}
              
              {hasRight(selectedPerson[RIGHTS_FIELDS.OPENCHAT_20K]) && (
                <div
                  onClick={() => setSelectedBenefit(getBenefitByTitle('20k'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-light-blue/20 cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('20k')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('20k')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('20k')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['20k']}</span>
                    </div>
                    <p className="text-gray-300">オープンチャット招待済</p>
                  </div>
                </div>
              )}
              
              {hasRight(selectedPerson[RIGHTS_FIELDS.ACAPELLA_30K]) && (
                <div
                  onClick={() => setSelectedBenefit(getBenefitByTitle('30k'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-light-blue/20 cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('30k')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('30k')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('30k')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['30k']}</span>
                    </div>
                    <p className="text-gray-300">アカペラ音源獲得: {selectedPerson[RIGHTS_FIELDS.ACAPELLA_30K]}曲</p>
                  </div>
                </div>
              )}
              
              {hasRight(selectedPerson[RIGHTS_FIELDS.SONG_REQUEST_40K]) && (
                <div
                  onClick={() => setSelectedBenefit(getBenefitByTitle('40k'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-light-blue/20 cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('40k')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('40k')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('40k')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['40k']}</span>
                    </div>
                    <p className="text-gray-300">強制リクエスト: {selectedPerson[RIGHTS_FIELDS.SONG_REQUEST_40K]}曲</p>
                  </div>
                </div>
              )}
              
              {hasRight(selectedPerson[RIGHTS_FIELDS.MIX_AUDIO_50K]) && (
                <div
                  onClick={() => setSelectedBenefit(getBenefitByTitle('50k'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-light-blue/20 cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('50k')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('50k')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('50k')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['50k']}</span>
                    </div>
                    <p className="text-gray-300">ミックス音源獲得: {selectedPerson[RIGHTS_FIELDS.MIX_AUDIO_50K]}曲</p>
                  </div>
                </div>
              )}
              
              {hasRight(selectedPerson[RIGHTS_FIELDS.MEMBERSHIP]) && (
                <div
                  onClick={() => setSelectedBenefit(getBenefitByTitle('メンバーシップ'))}
                  className="bg-deep-blue/50 p-4 md:p-6 rounded-xl border border-amber/30 bg-gradient-to-r from-gold/10 to-transparent cursor-pointer hover:border-amber transition-all text-center flex flex-col overflow-hidden"
                >
                  {/* ボトルラベル */}
                  {getBenefitByTitle('メンバーシップ')?.[BENEFIT_FIELDS.LABEL] && (
                    <div className="mb-4 pb-3 border-b border-amber/30 bg-amber/10 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-3 rounded-t-xl">
                      <div className="flex items-center justify-center pt-1">
                        <span className="text-sm md:text-base text-amber font-body">{getBenefitByTitle('メンバーシップ')[BENEFIT_FIELDS.TITLE]} {getBenefitByTitle('メンバーシップ')[BENEFIT_FIELDS.LABEL]}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-center justify-center mb-2">
                      <span className="text-3xl">{BENEFIT_ICONS['メンバーシップ']}</span>
                    </div>
                    <p className="text-gray-300">月内リクエスト対応中</p>
                  </div>
                </div>
              )}

              {selectedPerson[RIGHTS_FIELDS.SPECIAL] && (
                <div className="bg-gradient-to-r from-amber/20 to-light-blue/20 p-6 rounded-xl border border-amber/30 text-center">
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <span className="text-3xl">✨</span>
                    <h3 className="text-xl font-body text-amber">Special権利</h3>
                  </div>
                  <p className="text-gray-300">{selectedPerson[RIGHTS_FIELDS.SPECIAL]}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 特典説明ポップアップ */}
      {selectedBenefit && (
        <div 
          onClick={() => setSelectedBenefit(null)}
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="glass-effect rounded-2xl p-8 border border-light-blue/30 max-w-md w-full relative"
          >
            <button
              onClick={() => setSelectedBenefit(null)}
              className="absolute top-4 right-4 text-2xl text-gray-400 hover:text-white transition-colors"
            >
              ×
            </button>
            
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 mb-4">
                <span className="text-5xl">{selectedBenefit[BENEFIT_FIELDS.ICON]}</span>
              </div>
              <p className="text-lg font-bold mb-4 whitespace-pre-line">{selectedBenefit[BENEFIT_FIELDS.NAME]}</p>
              <p className="text-sm text-gray-400">{selectedBenefit[BENEFIT_FIELDS.DESCRIPTION]}</p>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* モバイル用ボトムナビゲーション */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass-effect border-t border-light-blue/30 z-40"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-4 h-16">
          <button
            onClick={() => setCurrentView('home')}
            className={`flex flex-col items-center justify-center gap-1 transition-all ${
              currentView === 'home'
                ? 'text-light-blue'
                : 'text-gray-400 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">🏠</span>
            <span className="text-xs font-body">Home</span>
          </button>

          <button
            onClick={() => setCurrentView('menu')}
            className={`flex flex-col items-center justify-center gap-1 transition-all ${
              currentView === 'menu'
                ? 'text-light-blue'
                : 'text-gray-400 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">🍾</span>
            <span className="text-xs font-body">Menu</span>
          </button>

          <button
            onClick={() => setCurrentView('rights')}
            className={`flex flex-col items-center justify-center gap-1 transition-all ${
              currentView === 'rights'
                ? 'text-light-blue'
                : 'text-gray-400 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">👥</span>
            <span className="text-xs font-body">権利者</span>
          </button>

          <button
            onClick={() => setCurrentView('icons')}
            className={`flex flex-col items-center justify-center gap-1 transition-all ${
              currentView === 'icons'
                ? 'text-light-blue'
                : 'text-gray-400 hover:text-light-blue'
            }`}
          >
            <span className="text-xl">🖼️</span>
            <span className="text-xs font-body">アイコン</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

export default App
