"use client"

import { useMemo, useState } from "react"
import { Navigation } from "@/components/navigation"
import { CampaignCard } from "@/components/campaign-card"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Search, Star, X } from "lucide-react"
import Link from "next/link"
import {
  getDerivedStatus,
  useCampaigns,
  cellToCampaignDisplay,
  type CampaignDisplay,
} from "@/lib"
import { useProtocol } from "@/lib/providers/protocol-provider"
import { createScopedLogger } from "ssri-ckboost"
import { PageLoading } from "@/components/ui/page-loading"

const log = createScopedLogger("HomePage")


export default function HomePage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [selectedEndorsers, setSelectedEndorsers] = useState<string[]>([])
  const [excludeExpired, setExcludeExpired] = useState(false)

  // Use campaign provider
  const { campaigns: campaignCells, featuredCampaigns: featuredCells, isLoading, error } = useCampaigns()
  const { endorserResolver } = useProtocol()

  // Convert Cell data to display format
  const campaigns = campaignCells.map(cell => {
    try {
      return cellToCampaignDisplay(cell, { endorserResolver })
    } catch (err) {
      log.error("Failed to convert campaign cell:", err)
      return null
    }
  }).filter((c): c is CampaignDisplay => c !== null)

  const featuredCampaigns = featuredCells.map(cell => {
    try {
      return cellToCampaignDisplay(cell, { endorserResolver })
    } catch (err) {
      log.error("Failed to convert featured campaign cell:", err)
      return null
    }
  }).filter((c): c is CampaignDisplay => c !== null)
    .filter((campaign) => !campaign.isExpired)

  const hasActiveFilters =
    searchTerm !== "" ||
    selectedDifficulties.length > 0 ||
    selectedCategories.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedEndorsers.length > 0 ||
    excludeExpired

  const filteredCampaigns = campaigns.filter((campaign) => {
    // If no filters are active, exclude featured campaigns from "All Campaigns" section
    if (!hasActiveFilters && featuredCampaigns.some(fc => fc.id === campaign.id)) {
      return false
    }

    const matchesSearch =
      campaign.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      campaign.shortDescription.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesDifficulty = selectedDifficulties.length === 0 || selectedDifficulties.includes(campaign.difficulty.toLowerCase())
    const matchesCategory =
      selectedCategories.length === 0 ||
      campaign.categories.some((cat) => selectedCategories.includes(cat.toLowerCase()))
    
    // Handle status filter with derived status
    const derivedStatus = getDerivedStatus(campaign)
    const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(derivedStatus)
    const matchesEndorser =
      selectedEndorsers.length === 0 ||
      (campaign.endorserLockHash &&
        selectedEndorsers.includes(campaign.endorserLockHash))
    const matchesExpiration = !excludeExpired || !campaign.isExpired

    return matchesSearch && matchesDifficulty && matchesCategory && matchesStatus && matchesEndorser && matchesExpiration
  })

  const allCategories = Array.from(new Set(campaigns.flatMap((c) => c.categories)))
  const endorserOptions = useMemo(() => {
    const mapping = new Map<string, { lockHash: string; name: string }>()
    campaigns.forEach((campaign) => {
      if (!campaign.endorserLockHash) {
        return
      }
      if (!mapping.has(campaign.endorserLockHash)) {
        mapping.set(campaign.endorserLockHash, {
          lockHash: campaign.endorserLockHash,
          name: campaign.endorser?.name || campaign.endorserName || campaign.endorserLockHash,
        })
      }
    })
    return Array.from(mapping.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )
  }, [campaigns])

  const noCampaignsLoaded =
    !isLoading && campaigns.length === 0 && featuredCampaigns.length === 0

  // Handle loading and empty dataset states
  if (isLoading || noCampaignsLoaded) {
    return (
      <PageLoading
        title="Loading Campaigns"
        description="Fetching the latest CKBoost campaigns and featured quests."
      />
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <Navigation />
        <main className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="text-red-500 text-xl mb-4">⚠️</div>
              <h2 className="text-xl font-semibold mb-2">Failed to Load Campaigns</h2>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>Try Again</Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const scrollToAllCampaigns = () => {
    const allCampaignsSection = document.getElementById('all-campaigns')
    if (allCampaignsSection) {
      allCampaignsSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleCategoryClick = (category: string) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories(selectedCategories.filter(c => c !== category))
    } else {
      setSelectedCategories([...selectedCategories, category])
    }
    // Scroll to filtered results after a brief delay to allow state update
    setTimeout(() => scrollToAllCampaigns(), 100)
  }

  const handleDifficultyClick = (difficulty: string) => {
    if (selectedDifficulties.includes(difficulty)) {
      setSelectedDifficulties(selectedDifficulties.filter(d => d !== difficulty))
    } else {
      setSelectedDifficulties([...selectedDifficulties, difficulty])
    }
    setTimeout(() => scrollToAllCampaigns(), 100)
  }

  const handleStatusClick = (status: string) => {
    if (selectedStatuses.includes(status)) {
      setSelectedStatuses(selectedStatuses.filter(s => s !== status))
    } else {
      setSelectedStatuses([...selectedStatuses, status])
    }
    setTimeout(() => scrollToAllCampaigns(), 100)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <Navigation />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="text-6xl">🚀</div>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                CKBoost
              </h1>
            </div>
            <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              Join campaigns, complete quests, and earn rewards while contributing to the CKB ecosystem. Build your
              reputation and grow with the community.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/dashboard">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  View My Progress
                </Button>
              </Link>
              <Link href="/leaderboard">
                <Button size="lg" variant="outline" className="bg-transparent backdrop-blur-sm">
                  View Leaderboard
                </Button>
              </Link>
            </div>
          </div>


          {/* Featured Campaigns */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold">Featured Campaigns</h2>
              <Badge variant="outline" className="bg-white dark:bg-gray-800">
                {featuredCampaigns.length} featured
              </Badge>
            </div>

            {featuredCampaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No featured campaigns are available right now. Check back soon!
              </p>
            ) : (
              <>
                {/* Mobile horizontal slider */}
                <div className="md:hidden -mx-4 px-4">
                  <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4">
                    {featuredCampaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        className="snap-start flex-shrink-0"
                        style={{
                          width: "min(420px, calc(100vw - 64px))",
                        }}
                      >
                        <CampaignCard
                          campaign={{
                            ...campaign,
                            status: getDerivedStatus(campaign),
                          }}
                          onCategoryClick={handleCategoryClick}
                          onDifficultyClick={handleDifficultyClick}
                          onStatusClick={handleStatusClick}
                          selectedCategories={selectedCategories}
                          selectedDifficulties={selectedDifficulties}
                          selectedStatuses={selectedStatuses}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Desktop grid */}
                <div className="hidden md:grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 justify-items-center">
                  {featuredCampaigns.map((campaign) => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={{
                        ...campaign,
                        status: getDerivedStatus(campaign),
                      }}
                      onCategoryClick={handleCategoryClick}
                      onDifficultyClick={handleDifficultyClick}
                      onStatusClick={handleStatusClick}
                      selectedCategories={selectedCategories}
                      selectedDifficulties={selectedDifficulties}
                      selectedStatuses={selectedStatuses}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Search and Filters */}
          <div className="mb-8 space-y-4">
            <Card className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border-gray-200 dark:border-gray-700">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Search & Filter All Campaigns</h3>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search campaigns..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  />
                </div>

                <div className="space-y-4">
                  {/* Difficulty Filter */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Difficulty:</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedDifficulties([])}
                        className={`h-auto p-1 text-xs ${selectedDifficulties.length > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["beginner", "easy", "medium", "advanced"].map((level) => (
                        <Badge
                          key={level}
                          variant={selectedDifficulties.includes(level) ? "default" : "outline"}
                          className="cursor-pointer hover:bg-primary/10 border-gray-300 dark:border-gray-600"
                          onClick={() => {
                            if (selectedDifficulties.includes(level)) {
                              setSelectedDifficulties(selectedDifficulties.filter(d => d !== level))
                            } else {
                              setSelectedDifficulties([...selectedDifficulties, level])
                            }
                          }}
                        >
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Category Filter */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Category:</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedCategories([])}
                        className={`h-auto p-1 text-xs ${selectedCategories.length > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {allCategories.map((category) => (
                        <Badge
                          key={category}
                          variant={selectedCategories.includes(category.toLowerCase()) ? "default" : "outline"}
                          className="cursor-pointer hover:bg-primary/10 border-gray-300 dark:border-gray-600"
                          onClick={() => {
                            const categoryLower = category.toLowerCase()
                            if (selectedCategories.includes(categoryLower)) {
                              setSelectedCategories(selectedCategories.filter(c => c !== categoryLower))
                            } else {
                              setSelectedCategories([...selectedCategories, categoryLower])
                            }
                          }}
                        >
                          {category}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Endorser Filter */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Endorser:</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedEndorsers([])}
                        className={`h-auto p-1 text-xs ${selectedEndorsers.length > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {endorserOptions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No endorsers available</span>
                      ) : (
                        endorserOptions.map((endorser) => (
                          <Badge
                            key={endorser.lockHash}
                            variant={selectedEndorsers.includes(endorser.lockHash) ? "default" : "outline"}
                            className="cursor-pointer hover:bg-primary/10 border-gray-300 dark:border-gray-600"
                            onClick={() => {
                              const isSelected = selectedEndorsers.includes(endorser.lockHash)
                              setSelectedEndorsers((prev) =>
                                isSelected
                                  ? prev.filter((hash) => hash !== endorser.lockHash)
                                  : [...prev, endorser.lockHash]
                              )
                              setTimeout(() => scrollToAllCampaigns(), 100)
                            }}
                          >
                            {endorser.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Status Filter */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">Status:</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedStatuses([])}
                        className={`h-auto p-1 text-xs ${selectedStatuses.length > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["active", "ending-soon", "upcoming", "completed"].map((status) => (
                        <Badge
                          key={status}
                          variant={selectedStatuses.includes(status) ? "default" : "outline"}
                          className="cursor-pointer hover:bg-primary/10 border-gray-300 dark:border-gray-600"
                          onClick={() => {
                            if (selectedStatuses.includes(status)) {
                              setSelectedStatuses(selectedStatuses.filter(s => s !== status))
                            } else {
                              setSelectedStatuses([...selectedStatuses, status])
                            }
                          }}
                        >
                          {status.charAt(0).toUpperCase() + status.slice(1)}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Expiration Filter */}
                  <div className="inline-flex w-fit items-center gap-3 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-4 py-2">
                    <Switch
                      checked={excludeExpired}
                      onCheckedChange={(checked) => {
                        setExcludeExpired(checked)
                        setTimeout(() => scrollToAllCampaigns(), 100)
                      }}
                      aria-label="Toggle to hide expired campaigns"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-muted-foreground">Exclude expired events</p>
                      <p className="text-xs text-muted-foreground">Hide campaigns whose quests have ended.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* All Campaigns */}
          <div id="all-campaigns" className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">
                {hasActiveFilters ? "Filtered Campaigns" : "Other Campaigns"}
              </h2>
              <Badge variant="outline" className="bg-white dark:bg-gray-800">
                {filteredCampaigns.length} campaigns
              </Badge>
            </div>

            {filteredCampaigns.length > 0 && (
              <>
                {/* Mobile slider */}
                <div className="md:hidden -mx-4 px-4">
                  <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4">
                    {filteredCampaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        className="snap-start flex-shrink-0"
                        style={{
                          width: "min(420px, calc(100vw - 64px))",
                        }}
                      >
                        <CampaignCard
                          campaign={{
                            ...campaign,
                            status: getDerivedStatus(campaign),
                          }}
                          onCategoryClick={handleCategoryClick}
                          onDifficultyClick={handleDifficultyClick}
                          onStatusClick={handleStatusClick}
                          selectedCategories={selectedCategories}
                          selectedDifficulties={selectedDifficulties}
                          selectedStatuses={selectedStatuses}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Desktop grid */}
                <div className="hidden md:grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 justify-items-center">
                  {filteredCampaigns.map((campaign) => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={{
                        ...campaign,
                        status: getDerivedStatus(campaign),
                      }}
                      onCategoryClick={handleCategoryClick}
                      onDifficultyClick={handleDifficultyClick}
                      onStatusClick={handleStatusClick}
                      selectedCategories={selectedCategories}
                      selectedDifficulties={selectedDifficulties}
                      selectedStatuses={selectedStatuses}
                    />
                  ))}
                </div>
              </>
            )}

            {filteredCampaigns.length === 0 && (
              <div className="text-center py-12">
                <Star className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-xl font-semibold mb-2">No campaigns found</h3>
                <p className="text-muted-foreground mb-4">
                  Try adjusting your search terms or filters to find campaigns that match your interests.
                </p>
                <Button
                  onClick={() => {
                    setSearchTerm("")
                    setSelectedDifficulties([])
                    setSelectedCategories([])
                    setSelectedStatuses([])
                  }}
                  variant="outline"
                >
                  Clear Filters
                </Button>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}
