<script setup lang="ts">
const { game, restore } = useGame()
onMounted(restore)
</script>

<template>
  <GameBoard v-if="game" />
  <StartScreen v-else />
</template>
